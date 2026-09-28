// Post-build checks on dist/. Exit 1 on the first failed group, printing every failure in it.
// 1. package exports resolve: ESM import and CJS require through the package's own "exports";
// 2. every JS output starts with the license banner;
// 3. the script-tag bundle is one file (no lazy chunks) and defines window.SfereSDK;
// 4. behaviourally, loading and tracking with the bundle only ever requests the configured host:
//    analytics-next's Segment-hosted defaults (cdn.segment.com, api.segment.io) stay in the code
//    but must never be reached.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Window } from "happy-dom";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  else console.log(`  ok  ${message}`);
};
const finish = (group) => {
  if (failures.length) {
    console.error(`verify: ${group} failed:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
};

// 1. Exports ---------------------------------------------------------------------------------
console.log("exports");
for (const file of [
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/cdn/sfere.js",
  "dist/cdn/sfere.min.js",
]) {
  check(existsSync(file), `${file} exists`);
}
finish("files");
const esm = await import(pkg.name);
check(typeof esm.SfereAnalytics?.load === "function", "ESM export SfereAnalytics.load");
check(typeof esm.sfereEnrichment === "function", "ESM export sfereEnrichment");
check(esm.version === pkg.version, `ESM version === ${pkg.version} (got ${esm.version})`);
const cjs = createRequire(import.meta.url)(pkg.name);
check(typeof cjs.SfereAnalytics?.load === "function", "CJS export SfereAnalytics.load");
check(typeof cjs.sfereEnrichment === "function", "CJS export sfereEnrichment");
check(cjs.version === pkg.version, `CJS version === ${pkg.version}`);
check(
  readFileSync("dist/index.d.ts", "utf8").includes("SfereLoadOptions"),
  "types declare SfereLoadOptions",
);
finish("exports");

// 2. Banner ----------------------------------------------------------------------------------
console.log("banner");
for (const file of [
  "dist/index.js",
  "dist/index.cjs",
  "dist/cdn/sfere.js",
  "dist/cdn/sfere.min.js",
]) {
  const head = readFileSync(file, "utf8").slice(0, 400);
  check(
    head.startsWith(`/*! Sfere SDK v${pkg.version}`) && head.includes("@segment/analytics-next"),
    `${file} starts with the Sfere license banner`,
  );
}
finish("banner");

// 3. Single-file IIFE ------------------------------------------------------------------------
console.log("script-tag bundle");
const cdnFiles = readdirSync("dist/cdn").filter((f) => f.endsWith(".js"));
check(
  cdnFiles.sort().join(",") === "sfere.js,sfere.min.js",
  `dist/cdn holds exactly sfere.js + sfere.min.js (found: ${cdnFiles.join(", ")})`,
);
const bundle = readFileSync("dist/cdn/sfere.min.js", "utf8");
check(
  !/\bimport\(/.test(readFileSync("dist/cdn/sfere.js", "utf8")),
  "no dynamic import() left in the bundle",
);
finish("script-tag bundle");

const HOST = "https://ingest.example.com";

/** Evaluates the bundle in a fresh happy-dom window and records every fetch it makes. */
async function runBundle({ attrs, drive }) {
  const window = new Window({
    url: "https://shop.example.com/product?gclid=VERIFY",
    settings: {
      enableJavaScriptEvaluation: true,
      // Only our own freshly built bundle is evaluated here.
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  const requests = [];
  requests.bodies = [];
  window.fetch = async (url, init) => {
    requests.push(String(url));
    try {
      if (typeof init?.body === "string") requests.bodies.push(JSON.parse(init.body));
    } catch {
      // Not JSON: nothing to record.
    }
    return new window.Response("{}", { status: 200 });
  };
  const script = window.document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  script.textContent = bundle;
  window.document.head.appendChild(script);
  await drive(window);
  await new Promise((r) => setTimeout(r, 300));
  await window.happyDOM.close();
  return requests;
}

async function assertOnlyHost(label, requests, allowed) {
  check(requests.length > 0, `${label}: made requests (${requests.length})`);
  const stray = requests.filter((u) => !allowed.some((prefix) => u.startsWith(prefix)));
  check(
    stray.length === 0,
    `${label}: every request goes to ${allowed.join(" or ")}${stray.length ? ` (stray: ${stray.join(", ")})` : ""}`,
  );
  check(
    !requests.some((u) => /segment\.(com|io)/.test(u)),
    `${label}: nothing to cdn.segment.com / api.segment.io`,
  );
  check(!requests.some((u) => /\/m$/.test(u)), `${label}: no remote-metrics /m request`);
}

// Auto-init from data attributes on the executing <script>.
let sdkShape;
const autoInit = await runBundle({
  attrs: { "data-write-key": "verify:secret", "data-host": HOST },
  drive: async (window) => {
    sdkShape = window.SfereSDK && Object.keys(window.SfereSDK).sort().join(",");
    await window.sfere;
    await window.sfere.track("verify_track");
    await window.sfere.page();
  },
});
check(
  sdkShape === "load,sfereEnrichment,version",
  "IIFE defines window.SfereSDK { load, sfereEnrichment, version }",
);
await assertOnlyHost("auto-init", autoInit, [`${HOST}/api/s/`]);
check(autoInit.bodies.length > 0, `auto-init: captured ${autoInit.bodies.length} JSON bodies`);
check(
  autoInit.bodies.every(
    (b) => b.context?.library?.name === pkg.name && b.context?.library?.version === pkg.version,
  ),
  `auto-init: context.library is { name: ${pkg.name}, version: ${pkg.version} } on the wire`,
);
check(
  autoInit.bodies.every((b) => !("_metadata" in b) && !("integrations" in b)),
  "auto-init: wire bodies carry no _metadata and no integrations",
);

// Explicit SfereSDK.load() with batching and a CDN origin.
const explicit = await runBundle({
  attrs: {},
  drive: async (window) => {
    const sfere = window.SfereSDK.load({
      writeKey: "verify:secret",
      host: HOST,
      cdnURL: "https://cdn.sfere.io",
      batching: { size: 2, timeout: 50 },
    });
    await sfere;
    await sfere.track("one");
    await sfere.identify("user-1");
  },
});
await assertOnlyHost("explicit batching", explicit, [`${HOST}/v1/batch/`, "https://cdn.sfere.io"]);
finish("behaviour");

console.log("verify: all checks passed");
