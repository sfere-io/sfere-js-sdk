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
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const distReact = resolve(repoRoot, "dist", "react.js");
const reactApp = resolve(here, "react-app.tsx");

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

  // The React harness (site/react.html) is built from the **packed tarball**, installed the way a
  // client installs it: `npm pack` -> extract into .tmp/consumer/node_modules/@fanfinity/sfere-sdk.
  // So a file missing from package.json "files", a broken "exports" map, or a dist/react.js that
  // bundles a second copy of the SDK fails here rather than in a client's build. The consumer's
  // other dependencies (react, analytics-next) resolve from the repo's node_modules above it.
  if (!existsSync(distReact)) {
    throw new Error(`test/e2e/global-setup.ts: ${distReact} is missing. Run \`npm run build\` first.`);
  }
  const consumerDir = resolve(tmpDir, "consumer");
  const installed = resolve(consumerDir, "node_modules", "@fanfinity", "sfere-sdk");
  rmSync(consumerDir, { recursive: true, force: true });
  mkdirSync(installed, { recursive: true });
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", consumerDir], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as { filename: string }[];
  execFileSync("tar", ["xzf", resolve(consumerDir, packed[0]!.filename), "-C", installed, "--strip-components=1"]);
  // Its own package scope: without a package.json here, resolvers treat the app as part of the
  // repo package and resolve "@fanfinity/sfere-sdk" to the repo's own dist (self-reference).
  writeFileSync(
    resolve(consumerDir, "package.json"),
    JSON.stringify({ name: "sfere-e2e-consumer", private: true, type: "module" }),
  );
  const consumerApp = resolve(consumerDir, "react-app.tsx");
  copyFileSync(reactApp, consumerApp);

  for (const mode of ["dev", "prod"] as const) {
    await build({
      entryPoints: [consumerApp],
      outfile: resolve(tmpDir, `react-${mode}`),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      minify: mode === "prod",
      define: { "process.env.NODE_ENV": JSON.stringify(mode === "dev" ? "development" : "production") },
      sourcemap: false,
      logLevel: "silent",
      // Same guard as a client bundle would need: fail if the SDK core ends up in the graph twice.
      metafile: true,
    }).then((result) => {
      const copies = Object.keys(result.metafile.inputs).filter((input) =>
        /node_modules\/@fanfinity\/sfere-sdk\/dist\/index\.js$/.test(input),
      );
      if (copies.length !== 1) {
        throw new Error(
          `test/e2e/global-setup.ts: react-${mode} bundle should include the installed dist/index.js exactly once, got ${copies.length}: ${copies.join(", ")}`,
        );
      }
    });
  }
}
