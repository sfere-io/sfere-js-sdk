#!/usr/bin/env node
// Builds dist/cdn/manifest.json from the already-built dist/cdn/*.js bundles.
// No dependencies: only Node's own fs/crypto/zlib/child_process.
//
// Run after `npm run build`. Deterministic given the same dist/ output and the
// same SOURCE_DATE_EPOCH (or git commit time) — two builds of the same commit
// on different machines/days produce byte-identical manifests.
//
// Usage: node scripts/cdn-manifest.mjs   (from the package directory, as `npm run cdn:manifest`)
//
// Serves every package that ships to the CDN. The browser SDK uses the defaults (path prefix
// `sdk`, entry `sfere.min.js`); another package sets `sfereCdn` in its package.json, e.g.
// packages/salla: { "prefix": "integrations/salla", "entry": "sfere-salla.min.js", ... }.
//
// Env:
//   SOURCE_DATE_EPOCH  unix seconds to stamp as builtAt (takes precedence)
//   CDN_BASE_URL       default https://cdn.sfere.io

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The package being described: the working directory when it has a package.json (how npm runs
// the script for each workspace), else packages/browser, this script's own package.
const repoRoot = existsSync(path.join(process.cwd(), "package.json"))
  ? process.cwd()
  : path.resolve(__dirname, "..");
const cdnDir = path.join(repoRoot, "dist", "cdn");
const pkgPath = path.join(repoRoot, "package.json");

function fail(msg) {
  console.error(`cdn-manifest: ${msg}`);
  process.exit(1);
}

if (!existsSync(cdnDir)) {
  fail(`${path.relative(repoRoot, cdnDir)} does not exist — run \`npm run build\` first.`);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;
if (!version) fail("package.json has no version");

const baseUrl = (process.env.CDN_BASE_URL || "https://cdn.sfere.io").replace(/\/+$/, "");
const cdnConfig = pkg.sfereCdn ?? {};
const prefix = cdnConfig.prefix ?? "sdk";
const entry = cdnConfig.entry ?? "sfere.min.js";

function builtAt() {
  if (process.env.SOURCE_DATE_EPOCH) {
    const epoch = Number(process.env.SOURCE_DATE_EPOCH);
    if (Number.isFinite(epoch)) return new Date(epoch * 1000).toISOString();
  }
  try {
    const iso = execFileSync("git", ["log", "-1", "--format=%cI"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (iso) return new Date(iso).toISOString();
  } catch {
    // not a git checkout, or git unavailable — fall through
  }
  // Last resort: wall clock. Not reproducible; only hit outside git/CI.
  return new Date().toISOString();
}

// Only the script bundles go in the manifest — never manifest.json itself,
// and never anything that isn't a built CDN artifact.
const bundleNames = readdirSync(cdnDir)
  .filter((f) => f.endsWith(".js"))
  .sort(); // stable order: sfere.js, sfere.min.js (browser SDK)

if (bundleNames.length === 0) fail(`no .js bundles found in ${path.relative(repoRoot, cdnDir)}`);

const files = bundleNames.map((name) => {
  const p = path.join(cdnDir, name);
  const buf = readFileSync(p);
  const sha384 = createHash("sha384").update(buf).digest("base64");
  return {
    path: `dist/cdn/${name}`,
    bytes: statSync(p).size,
    gzipBytes: gzipSync(buf, { level: 9 }).length,
    sha384: `sha384-${sha384}`,
  };
});

// Alias prefix per docs/CDN-POLICY.md: >=1.0.0 -> v{major}; 0.x -> v0.{minor};
// prereleases (a '-' in the version) never get an alias.
const isPrerelease = version.includes("-");
const [major, minor] = version.split(/[.-]/).map(Number);
const aliasSegment = isPrerelease ? null : major >= 1 ? `v${major}` : `v0.${minor}`;

const manifest = {
  name: pkg.name,
  version,
  builtAt: builtAt(),
  files,
  urls: {
    immutable: `${baseUrl}/${prefix}/v${version}/`,
    alias: aliasSegment ? `${baseUrl}/${prefix}/${aliasSegment}/` : null,
  },
};

const manifestPath = path.join(cdnDir, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(repoRoot, manifestPath)}`);

const minFile = files.find((f) => f.path === `dist/cdn/${entry}`);
if (minFile) {
  const tagUrl = `${manifest.urls.immutable}${entry}`;
  console.log("\nCopy-paste <script> tag (immutable, SRI-pinned):\n");
  console.log(
    `<script src="${tagUrl}" integrity="${minFile.sha384}" crossorigin="anonymous"></script>`,
  );
}
