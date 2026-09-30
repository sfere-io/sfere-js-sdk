// Post-build checks on dist/cdn/, run from packages/salla. Exit 1 on any failure.
// 1. the CDN artifact is exactly one self-contained script, with the license banner;
// 2. it carries no configuration: no write key, host, tunnel or vendor name is baked in;
// 3. behaviourally, evaluated in a DOM with a mocked storefront, it injects the pinned SDK with
//    SRI and forwards a storefront event onto the window.sfere queue.
import { readdirSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { entry } = pkg.sfereCdn;
const FILE = `dist/cdn/${entry}`;
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  else console.log(`  ok  ${message}`);
};

const files = readdirSync("dist/cdn").filter((f) => f.endsWith(".js"));
check(files.join(",") === entry, `dist/cdn holds exactly ${entry} (found: ${files.join(", ")})`);
const code = readFileSync(FILE, "utf8");
check(
  code.startsWith(`/*! Sfere Salla integration v${pkg.version} |`),
  `${FILE} starts with the license banner for v${pkg.version}`,
);
check(!/\bimport\(|\brequire\(/.test(code), "no import() or require() left in the bundle");
check(
  /https:\/\/cdn\.sfere\.io\/sdk\/v\d+\.\d+\.\d+\/sfere\.min\.js/.test(code) &&
    /sha384-[A-Za-z0-9+/=]{64}/.test(code),
  "pins an immutable SDK URL with a sha384 SRI hash",
);
const hosts = [...new Set(code.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [])];
check(
  hosts.join(",") === "https://cdn.sfere.io",
  `the only host in the bundle is https://cdn.sfere.io (found: ${hosts.join(", ")})`,
);
check(!/ngrok/i.test(code), "no tunnel URL in the bundle");

const window = new Window({
  url: "https://demo.salla.sa/product/p1",
  settings: {
    enableJavaScriptEvaluation: true,
    // Only our own freshly built bundle is evaluated here.
    suppressInsecureJavaScriptEnvironmentWarning: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
const trackers = [];
window.Salla = {
  onReady: (cb) => cb(),
  analytics: { registerTracker: (t) => trackers.push(t) },
  config: { get: (k) => ({ "store.id": "123", "user.type": "guest" })[k] },
};
const script = window.document.createElement("script");
script.setAttribute("data-write-key", "verify-key");
script.setAttribute("data-host", "https://ingest.example.com/");
script.textContent = code;
window.document.head.appendChild(script);
trackers[0]?.track("Product Viewed", { product_id: "p1" });

const sdk = window.document.querySelector('script[src^="https://cdn.sfere.io/sdk/"]');
check(Boolean(sdk), "injects the SDK script from cdn.sfere.io");
check(
  sdk?.getAttribute("integrity")?.startsWith("sha384-") &&
    sdk?.getAttribute("crossorigin") === "anonymous",
  "the SDK script carries integrity + crossorigin=anonymous",
);
check(
  sdk?.getAttribute("data-write-key") === "verify-key" &&
    sdk?.getAttribute("data-host") === "https://ingest.example.com",
  "the SDK script gets the write key and host from the loading tag",
);
check(trackers.length === 1 && trackers[0].name === "Sfere", "registers one tracker named Sfere");
const queued = Array.from(window.sfere ?? []).map((c) => c[0]);
check(queued.join(",") === "page,track", `queues page then track (got ${queued.join(",")})`);
const track = Array.from(window.sfere ?? []).find((c) => c[0] === "track");
check(
  track?.[2]?.store_id === "123" && track?.[2]?.source === "salla_browser",
  "track carries store_id and source",
);
check(window.SfereSalla?.version === pkg.version, `window.SfereSalla.version === ${pkg.version}`);
await window.happyDOM.close();

if (failures.length) {
  console.error(`verify: failed:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("verify: all checks passed");
