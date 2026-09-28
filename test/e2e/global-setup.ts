// Runs once before the whole Playwright run (see `globalSetup` in ../../playwright.config.ts).
//
// The npm build (`dist/index.js`) keeps `@segment/analytics-next` as an external ESM import
// (confirmed by reading the built file: it re-exports `import { AnalyticsBrowser } from
// "@segment/analytics-next"` rather than inlining it), so a bare `<script type="module">` test
// page can't resolve that bare specifier without a bundler or an import map. Instead of adding an
// import map (which would have to duplicate analytics-next's own internal dynamic imports), bundle
// a tiny entry that re-exports the real npm build with esbuild — the same bundler tsup uses
// internally for the CDN build, already present in node_modules as tsup's own dependency — so the
// browser gets one self-contained ESM file that still exercises the actual `dist/index.js`
// contract end to end.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");
const distIndex = resolve(repoRoot, "dist", "index.js");
const tmpDir = resolve(here, ".tmp");
const entryFile = resolve(tmpDir, "esm-entry.mjs");
// No .js extension on purpose: it keeps this generated, non-authored bundle out of the repo's
// (unrelated) eslint/prettier scope, which only look at recognized source extensions.
const outFile = resolve(tmpDir, "esm-bundle");

export default async function globalSetup(): Promise<void> {
  if (!existsSync(distIndex)) {
    throw new Error(
      `test/e2e/global-setup.ts: ${distIndex} is missing. Run \`npm run build\` before \`npm run test:e2e\`.`,
    );
  }
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    entryFile,
    `export { SfereAnalytics, sfereEnrichment, version } from ${JSON.stringify(distIndex)};\n`,
  );
  await build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    sourcemap: false,
    logLevel: "silent",
  });
}
