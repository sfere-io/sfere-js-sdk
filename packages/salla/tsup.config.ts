import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// No third-party code is bundled: the SDK itself is loaded from the CDN at runtime.
const banner = `/*! Sfere Salla integration v${pkg.version} | (c) Fanfinity Sports Engagement Solutions Holding Ltd. All rights reserved. */`;

// One self-contained classic script, the only artifact: dist/cdn/sfere-salla.min.js.
export default defineConfig({
  entry: { "cdn/sfere-salla.min": "src/iife.ts" },
  format: ["iife"],
  platform: "browser",
  // ES2017, as the tracker verified live on a Salla storefront was built; the SDK it loads is
  // ES2018, so this never narrows browser support further.
  target: "es2017",
  splitting: false,
  minify: true,
  sourcemap: false,
  clean: true,
  define: { __SFERE_SALLA_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: banner },
  outExtension: () => ({ js: ".js" }),
  tsconfig: "tsconfig.build.json",
});
