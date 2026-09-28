// Zero-dependency Node HTTP mock of the Sfere ingestion endpoint, for the Playwright e2e suite.
// Never names the underlying ingestion vendor (see ../../CLAUDE.md company rule).
//
// Starts two servers on two origins, so tests exercise real cross-origin CORS the way production
// does (the test site and the ingestion host are never the same origin):
//   - site   http://127.0.0.1:4310  static pages from test/e2e/site/, plus the CDN emulation
//            (dist/cdn/*) and the bundled npm/ESM test build (test/e2e/.tmp/esm-bundle)
//   - ingest http://127.0.0.1:4311  POST /api/s/:type, /v1/batch(/b)?, and the test-only
//            /__events (GET) / /__reset (POST) introspection routes
//
// Started by Playwright's `webServer` config (see ../../playwright.config.ts).

import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFile, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");
const siteDir = resolve(here, "site");
const cdnDir = resolve(repoRoot, "dist", "cdn");
const tmpDir = resolve(here, ".tmp");

const SITE_PORT = 4310;
const INGEST_PORT = 4311;
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000;

/** `POST /api/s/:type` accepts either the one-letter form or the spelled-out event name. */
const TYPE_ALIASES = {
  t: "t",
  track: "t",
  p: "p",
  page: "p",
  i: "i",
  identify: "i",
  g: "g",
  group: "g",
  a: "a",
  alias: "a",
};

const BATCH_PATHS = new Set(["/v1/batch", "/v1/b", "/v1/batch/b"]);

/** Every request the ingest server has handled since the last /__reset. */
const events = [];

function readBody(req) {
  return new Promise((settle, fail) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        req.destroy();
        fail(Object.assign(new Error("payload too large"), { code: "TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      settle(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      fail(error);
    });
  });
}

/** `Authorization: Basic base64(writeKey:)` -> the write key, with the trailing ":" stripped. */
function keyFromAuth(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.startsWith("Basic ")) return undefined;
  try {
    const decoded = Buffer.from(headerValue.slice("Basic ".length), "base64").toString("utf8");
    return decoded.endsWith(":") ? decoded.slice(0, -1) : decoded;
  } catch {
    return undefined;
  }
}

function resolveWriteKey(req, url, bodyWriteKey) {
  const auth = keyFromAuth(req.headers.authorization);
  if (auth) return { key: auth, source: "basic" };
  const header = req.headers["x-write-key"];
  if (typeof header === "string" && header) return { key: header, source: "header" };
  const query = url.searchParams.get("writekey");
  if (query) return { key: query, source: "query" };
  if (typeof bodyWriteKey === "string" && bodyWriteKey) return { key: bodyWriteKey, source: "body" };
  return { key: undefined, source: "none" };
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function headersToRecord(rawHeaders) {
  const out = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    out[name] = Array.isArray(value) ? value.join(", ") : (value ?? "");
  }
  return out;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  // No credentials: the header is simply omitted (absence == not allowed).
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Write-Key");
  res.setHeader("Access-Control-Max-Age", "3600");
}

const ingestServer = createServer((req, res) => {
  void handleIngest(req, res);
});

async function handleIngest(req, res) {
  const url = new URL(req.url ?? "/", `http://${HOST}:${INGEST_PORT}`);
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/__events") {
    sendJson(res, 200, events);
    return;
  }

  if (req.method === "POST" && url.pathname === "/__reset") {
    events.length = 0;
    sendJson(res, 200, { ok: true });
    return;
  }

  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch (error) {
    if (error && error.code === "TOO_LARGE") {
      sendJson(res, 413, { ok: false, error: "payload too large" });
      return;
    }
    sendJson(res, 400, { ok: false, error: "bad request" });
    return;
  }

  const text = rawBody.toString("utf8");
  let parsedBody = {};
  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = { __unparsed: text };
    }
  }
  const bodyWriteKey =
    parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? parsedBody.writeKey
      : undefined;

  const baseRecord = {
    method: req.method ?? "",
    path: url.pathname,
    headers: headersToRecord(req.headers),
    body: parsedBody,
    timestamp: Date.now(),
  };

  const singleMatch = req.method === "POST" && /^\/api\/s\/([a-zA-Z]+)$/.exec(url.pathname);
  if (singleMatch) {
    const kind = TYPE_ALIASES[singleMatch[1].toLowerCase()];
    if (!kind) {
      events.push({ ...baseRecord, keySource: "none", writeKey: null, unexpected: true });
      sendJson(res, 404, { ok: false, error: "unknown event type" });
      return;
    }
    // Deliberately NOT reading the write key from the body on this route family.
    const { key, source } = resolveWriteKey(req, url, undefined);
    events.push({ ...baseRecord, keySource: source, writeKey: key ?? null });
    if (!key) {
      sendJson(res, 200, { ok: false, error: "stream not found" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && BATCH_PATHS.has(url.pathname)) {
    const batch = Array.isArray(parsedBody)
      ? parsedBody
      : Array.isArray(parsedBody.batch)
        ? parsedBody.batch
        : [];
    const { key, source } = resolveWriteKey(req, url, bodyWriteKey);
    events.push({ ...baseRecord, keySource: source, writeKey: key ?? null, batchSize: batch.length });
    if (!key) {
      sendJson(res, 200, { ok: false, error: "stream not found" });
      return;
    }
    sendJson(res, 200, { ok: true, receivedEvents: batch.length, okEvents: batch.length });
    return;
  }

  events.push({ ...baseRecord, keySource: "none", writeKey: null, unexpected: true });
  sendJson(res, 404, { ok: false, error: "not found" });
}

// ---- site server: static pages + the CDN/npm build emulation -------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function contentTypeFor(path) {
  return MIME[extname(path)] ?? "application/octet-stream";
}

function serveFile(res, filePath) {
  readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  });
}

function sha384(buffer) {
  return `sha384-${createHash("sha384").update(buffer).digest("base64")}`;
}

/** Same shape and length as `correct`, guaranteed not to match: flip one base64 character. */
function wrongIntegrityOf(correct) {
  const body = correct.slice("sha384-".length);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const current = body.charAt(0);
  const replacement = [...alphabet].find((char) => char !== current) ?? "A";
  return `sha384-${replacement}${body.slice(1)}`;
}

function serveSriPage(res, variant) {
  const bundlePath = join(cdnDir, "sfere.min.js");
  if (!existsSync(bundlePath)) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("dist/cdn/sfere.min.js is missing; run `npm run build` before `npm run test:e2e`.");
    return;
  }
  const correct = sha384(readFileSync(bundlePath));
  const integrity = variant === "bad" ? wrongIntegrityOf(correct) : correct;
  const template = readFileSync(join(siteDir, "sri.template.html"), "utf8");
  const html = template
    .split("{{INTEGRITY}}")
    .join(integrity)
    .split("{{SRC}}")
    .join("/sdk/v0.1.0/sfere.min.js");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const siteServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${SITE_PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/sri.html") {
    serveSriPage(res, "good");
    return;
  }
  if (pathname === "/sri-bad.html") {
    serveSriPage(res, "bad");
    return;
  }

  if (pathname === "/sdk/v0.1/sfere.min.js" || pathname === "/sdk/v0.1.0/sfere.min.js") {
    serveFile(res, join(cdnDir, "sfere.min.js"));
    return;
  }
  if (pathname === "/sdk/v0.1/sfere.js" || pathname === "/sdk/v0.1.0/sfere.js") {
    serveFile(res, join(cdnDir, "sfere.js"));
    return;
  }

  if (pathname === "/esm/bundle") {
    const bundlePath = join(tmpDir, "esm-bundle");
    if (!existsSync(bundlePath)) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("test/e2e/.tmp/esm-bundle is missing; global-setup did not run.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(bundlePath));
    return;
  }

  if (pathname === "/") pathname = "/generic.html";

  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(siteDir, safePath);
  if (!filePath.startsWith(siteDir)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("bad path");
    return;
  }
  serveFile(res, filePath);
});

siteServer.listen(SITE_PORT, HOST, () => {
  console.log(`mock-ingest: site listening on http://${HOST}:${SITE_PORT}`);
});
ingestServer.listen(INGEST_PORT, HOST, () => {
  console.log(`mock-ingest: ingest listening on http://${HOST}:${INGEST_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    siteServer.close();
    ingestServer.close();
    process.exit(0);
  });
}
