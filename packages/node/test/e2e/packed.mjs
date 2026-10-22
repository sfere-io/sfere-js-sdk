// End to end on the published artifact: `npm pack`, install the tarball into a separate consumer
// package (its own package scope, so nothing resolves back to this repo's src or dist), then run a
// real ESM app and a real CommonJS app. Each app is an HTTP server; a browser-like request reaches
// it (behind a proxy, with ad cookies and a landing URL), the app forwards it to Sfere with
// requestContext(), and a mock ingestion host records what arrives. A TypeScript consumer is also
// type-checked against the published .d.ts under node16 and bundler resolution.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..", "..");
const tmp = resolve(here, ".tmp");
const consumer = resolve(tmp, "consumer");
const installed = resolve(consumer, "node_modules", "@sfere.io", "sfere-node");

rmSync(tmp, { recursive: true, force: true });
mkdirSync(installed, { recursive: true });
const [packed] = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
execFileSync("tar", ["xzf", resolve(tmp, packed.filename), "-C", installed, "--strip-components=1"]);
const version = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('./package.json'))"], { cwd: pkgDir, encoding: "utf8" })).version;
const files = packed.files.map((f) => f.path).sort();
assert.ok(files.includes("dist/index.js") && files.includes("dist/index.cjs") && files.includes("dist/index.d.ts"));
assert.ok(files.includes("THIRD_PARTY_NOTICES.md"), "tarball ships THIRD_PARTY_NOTICES.md");
assert.ok(!files.some((f) => f.startsWith("src/") || f.startsWith("test/")), "tarball ships no src/ or test/");
console.log(`  ok  packed ${packed.filename} (${files.length} files) and installed it into a consumer`);

writeFileSync(
  resolve(consumer, "package.json"),
  JSON.stringify({ name: "sfere-node-e2e-consumer", private: true, type: "module" }),
);

// The app both flavours run: receive one request, forward it, flush, exit.
const app = (importLine) => `${importLine}
const [ingest, port] = [process.env.INGEST, Number(process.env.APP_PORT)];
const sfere = new SfereAnalytics({ writeKey: "e2eKey:e2eSecret", host: ingest, flushInterval: 50 });
const server = createServer(async (req, res) => {
  sfere.identify({ userId: "user_e2e", traits: { email: "fan@example.com" }, context: requestContext(req) });
  sfere.track({
    userId: "user_e2e",
    event: "purchase",
    properties: { transaction_id: "order_1", currency: "SAR", value: 179.98, sfere_dedup_id: "order_1",
      items: [{ item_id: "sku_123", price: 89.99, quantity: 2 }] },
    context: requestContext(req),
  });
  // A Fetch API Request (route handlers, edge runtimes) through the same helper.
  const fetchReq = new Request("https://shop.example.com/api/refund?ttclid=TT1", {
    headers: { "x-forwarded-for": "198.51.100.20", "user-agent": "FetchUA/1" },
  });
  sfere.track({ userId: "user_e2e", event: "refund", properties: { value: 10 }, context: requestContext(fetchReq) });
  await sfere.closeAndFlush();
  res.end("ok");
  server.close();
});
server.listen(port, "127.0.0.1", () => process.send?.("ready"));
`;
writeFileSync(
  resolve(consumer, "app.mjs"),
  app('import { createServer } from "node:http";\nimport { SfereAnalytics, requestContext } from "@sfere.io/sfere-node";'),
);
writeFileSync(
  resolve(consumer, "app.cjs"),
  app('const { createServer } = require("node:http");\nconst { SfereAnalytics, requestContext } = require("@sfere.io/sfere-node");'),
);

async function runApp(file) {
  const received = [];
  const ingest = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      received.push({ path: req.url, headers: req.headers, body: JSON.parse(data) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true,"okEvents":1,"receivedEvents":1}');
    });
  });
  await new Promise((r) => ingest.listen(0, "127.0.0.1", r));
  const appPort = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [file], {
    cwd: consumer,
    env: { ...process.env, INGEST: `http://127.0.0.1:${ingest.address().port}`, APP_PORT: String(appPort) },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  await new Promise((r, j) => {
    child.once("message", r);
    child.once("exit", (code) => j(new Error(`${file} exited early with ${code}`)));
  });
  // The browser request, as it reaches the app through a load balancer.
  const response = await fetch(
    `http://127.0.0.1:${appPort}/checkout/thanks?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=GCL1&fbclid=FBC1`,
    {
      headers: {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "shop.example.com",
        "user-agent": "Mozilla/5.0 (iPhone) E2E",
        "accept-language": "ar-SA,ar;q=0.9",
        referer: "https://www.google.com/",
        cookie: "_fbp=fb.1.1700000000000.111; _ttp=TTP1; _gcl_aw=GCL.1700000000.OLDGCL",
      },
    },
  );
  assert.equal(await response.text(), "ok");
  await new Promise((r) => child.once("exit", r));
  ingest.close();
  return received;
}

function assertDelivery(label, received) {
  assert.ok(received.length >= 1, `${label}: the app delivered at least one batch`);
  for (const request of received) {
    assert.equal(request.path, "/v1/batch", `${label}: posts to /v1/batch`);
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from("e2eKey:e2eSecret:").toString("base64")}`,
      `${label}: Basic auth with the write key`,
    );
    assert.equal(request.headers["user-agent"], `@sfere.io/sfere-node/${version}`);
  }
  const events = received.flatMap((r) => r.body.batch);
  assert.deepEqual(events.map((e) => e.type), ["identify", "track", "track"], `${label}: call order kept`);
  for (const event of events) {
    assert.ok(!("_metadata" in event) && !("integrations" in event), `${label}: no _metadata/integrations`);
    assert.deepEqual(Object.keys(event.context.library).sort(), ["base", "name", "version"]);
    assert.equal(event.context.library.name, "@sfere.io/sfere-node");
    assert.equal(event.context.library.version, version);
  }
  const [identify, purchase, refund] = events;
  for (const event of [identify, purchase]) {
    assert.equal(event.context.ip, "203.0.113.7", `${label}: end-user IP from X-Forwarded-For`);
    assert.equal(event.context.userAgent, "Mozilla/5.0 (iPhone) E2E");
    assert.equal(event.context.locale, "ar-SA");
    assert.equal(event.context.page.url, "https://shop.example.com/checkout/thanks?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=GCL1&fbclid=FBC1");
    assert.equal(event.context.page.referrer, "https://www.google.com/");
    assert.deepEqual(event.context.campaign, { source: "google", medium: "cpc", name: "spring" });
    assert.equal(event.context.clientIds.fbp, "fb.1.1700000000000.111");
    assert.equal(event.context.clientIds.ttp, "TTP1");
    assert.equal(event.context.clientIds.gclid, "GCL1", `${label}: landing gclid beats the older cookie`);
    assert.match(event.context.clientIds.fbc, /^fb\.1\.\d{13}\.FBC1$/, `${label}: fbclid -> fbc`);
  }
  assert.equal(identify.traits.email, "fan@example.com");
  assert.equal(purchase.properties.sfere_dedup_id, "order_1", `${label}: caller's dedup id kept`);
  assert.deepEqual(purchase.properties.items, [{ item_id: "sku_123", price: 89.99, quantity: 2 }]);
  assert.equal(refund.context.ip, "198.51.100.20", `${label}: Fetch Request IP`);
  assert.equal(refund.context.clientIds.ttclid, "TT1");
  assert.equal(refund.properties.sfere_dedup_id, refund.messageId, `${label}: default dedup id`);
  console.log(`  ok  ${label}: ${events.length} events delivered with the full wire contract`);
}

assertDelivery("ESM app", await runApp("app.mjs"));
assertDelivery("CommonJS app", await runApp("app.cjs"));

// Types, as a TypeScript user sees them: the helper's result goes straight into track().
writeFileSync(
  resolve(consumer, "consumer.ts"),
  `import { SfereAnalytics, requestContext, type SfereNodeOptions } from "@sfere.io/sfere-node";
import type { IncomingMessage } from "node:http";
const options: SfereNodeOptions = { writeKey: "k:s", host: "https://ingest.example.com" };
const sfere = new SfereAnalytics(options);
export function handle(req: IncomingMessage, request: Request): void {
  sfere.track({ userId: "u", event: "purchase", properties: { value: 1 }, context: requestContext(req) });
  sfere.identify({ userId: "u", context: requestContext(request, { trustProxy: false }) });
}
`,
);
const tsc = resolve(pkgDir, "..", "..", "node_modules", "typescript", "bin", "tsc");
for (const [moduleResolution, module] of [
  ["node16", "node16"],
  ["bundler", "esnext"],
]) {
  execFileSync(
    process.execPath,
    [tsc, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--types", "node", "--lib", "es2022,dom", "--moduleResolution", moduleResolution, "--module", module, "consumer.ts"],
    { cwd: consumer, stdio: "inherit" },
  );
  console.log(`  ok  TypeScript consumer compiles (moduleResolution ${moduleResolution})`);
}
console.log("e2e: all checks passed");
