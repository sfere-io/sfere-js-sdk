import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig, type Options } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};
const aNext = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve("@segment/analytics-next/package.json"),
    "utf8",
  ),
) as { version: string };

const banner = `/*! Sfere SDK v${pkg.version} | (c) Fanfinity Sports Engagement Solutions Holding Ltd. All rights reserved.
 * Bundles @segment/analytics-next v${aNext.version} (MIT, (c) Segment.io, Inc.) and its MIT/ISC dependencies.
 * Full license texts: THIRD_PARTY_NOTICES.md in the @fanfinity/sfere-sdk package. */`;

// The React entry bundles nothing third-party: React and the SDK stay external.
const reactBanner = `/*! Sfere SDK v${pkg.version} React bindings | (c) Fanfinity Sports Engagement Solutions Holding Ltd. All rights reserved. */`;

const define = {
  __SFERE_VERSION__: JSON.stringify(pkg.version),
  __SFERE_BASE_VERSION__: JSON.stringify(aNext.version),
};

// Script-tag bundle: one self-contained file. `splitting: false` makes esbuild inline every
// dynamic import() in analytics-next as a local require instead of emitting lazy chunks.
const cdn = (minify: boolean): Options => ({
  entry: { [minify ? "cdn/sfere.min" : "cdn/sfere"]: "src/cdn/iife.ts" },
  format: ["iife"],
  platform: "browser",
  // ES2018: native async/await, object spread and async iteration; every browser analytics-next
  // itself supports (Chrome 64+, Safari 12+, Firefox 58+) runs it untranspiled, saving bytes.
  target: "es2018",
  noExternal: [/.*/],
  splitting: false,
  minify,
  sourcemap: false,
  clean: false,
  define,
  banner: { js: banner },
  outExtension: () => ({ js: ".js" }),
});

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    platform: "browser",
    target: "es2020",
    dts: true,
    sourcemap: true,
    clean: true,
    define,
    banner: { js: banner },
    tsconfig: "tsconfig.build.json",
  },
  // React bindings: a separate entry so the main entry never pulls in React. The SDK itself stays
  // external (imported by package name) so apps share one module and one instance.
  {
    entry: { react: "src/react.ts" },
    format: ["esm", "cjs"],
    platform: "browser",
    target: "es2020",
    dts: true,
    sourcemap: true,
    clean: false,
    external: ["react", "@fanfinity/sfere-sdk"],
    define,
    banner: { js: `${reactBanner}\n"use client";` },
    tsconfig: "tsconfig.build.json",
  },
  cdn(false),
  cdn(true),
]);
