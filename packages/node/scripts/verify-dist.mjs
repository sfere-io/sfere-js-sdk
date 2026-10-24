// Post-build checks on dist/. Exit 1 on the first failed group, printing every failure in it.
// 1. package exports resolve: ESM import and CJS require through the package's own "exports";
// 2. every JS output starts with the license banner, and the private shared package is inlined;
// 3. behaviourally, the built SDK only ever requests the configured host (the wrapped library's
//    api.segment.io default stays in its code but must never be reached), with the Sfere wire shape.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

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

console.log("exports");
for (const file of ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.d.cts"]) {
  check(existsSync(file), `${file} exists`);
}
finish("files");
const esm = await import(pkg.name);
const cjs = createRequire(import.meta.url)(pkg.name);
for (const [label, mod] of [
  ["ESM", esm],
  ["CJS", cjs],
]) {
  check(typeof mod.SfereAnalytics === "function", `${label} export SfereAnalytics`);
  check(typeof mod.requestContext === "function", `${label} export requestContext`);
  check(mod.version === pkg.version, `${label} version === ${pkg.version} (got ${mod.version})`);
}
check(
  readFileSync("dist/index.d.ts", "utf8").includes("SfereNodeOptions"),
  "types declare SfereNodeOptions",
);
finish("exports");

console.log("banner and bundling");
for (const file of ["dist/index.js", "dist/index.cjs"]) {
  const code = readFileSync(file, "utf8");
  check(
    code.startsWith(`/*! Sfere Node SDK v${pkg.version}`) &&
      code.slice(0, 400).includes("MIT License") &&
      code.slice(0, 400).includes("@segment/analytics-node"),
    `${file} starts with the Sfere license banner`,
  );
  check(!code.includes("@sfere.io/sfere-shared"), `${file} inlines the private shared package`);
}
check(
  !Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).includes("@sfere.io/sfere-shared"),
  "the private shared package is not a runtime dependency",
);
finish("banner and bundling");

console.log("behaviour");
const bodies = [];
const server = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    bodies.push({ path: req.url, body: JSON.parse(data) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const host = `http://127.0.0.1:${server.address().port}`;
const requested = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  requested.push(String(url));
  return realFetch(url, init);
};
for (const [label, mod] of [
  ["ESM", esm],
  ["CJS", cjs],
]) {
  const sfere = new mod.SfereAnalytics({ writeKey: "verify:secret", host, flushInterval: 10 });
  sfere.track({ userId: "verify", event: `verify_${label}` });
  await sfere.closeAndFlush();
}
globalThis.fetch = realFetch;
server.close();
check(requested.length === 2, `made one request per client (${requested.length})`);
check(
  requested.every((url) => url === `${host}/v1/batch`),
  `every request goes to ${host}/v1/batch (got ${requested.join(", ")})`,
);
check(!requested.some((url) => /segment\.(io|com)/.test(url)), "nothing to api.segment.io");
const events = bodies.flatMap((b) => b.body.batch);
check(
  events.every(
    (e) => e.context?.library?.name === pkg.name && e.context?.library?.version === pkg.version,
  ),
  `context.library is { name: ${pkg.name}, version: ${pkg.version} } on the wire`,
);
check(
  events.every((e) => !("_metadata" in e) && !("integrations" in e)),
  "wire events carry no _metadata and no integrations",
);
check(
  events.every((e) => e.properties?.sfere_dedup_id === e.messageId),
  "track events carry sfere_dedup_id = messageId",
);
finish("behaviour");

console.log("verify: all checks passed");
