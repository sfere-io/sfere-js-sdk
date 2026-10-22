import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};
const base = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve("@segment/analytics-node/package.json"),
    "utf8",
  ),
) as { version: string };

// @segment/analytics-node stays an external dependency (installed next to this package); only the
// private @sfere.io/sfere-shared source is bundled in, as a devDependency.
const banner = `/*! Sfere Node SDK v${pkg.version} | (c) Fanfinity Sports Engagement Solutions Holding Ltd. | MIT License
 * Uses @segment/analytics-node v${base.version} (MIT, (c) Segment.io, Inc.) as a dependency.
 * Full license texts: THIRD_PARTY_NOTICES.md in the @sfere.io/sfere-node package. */`;

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  platform: "node",
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  define: {
    __SFERE_VERSION__: JSON.stringify(pkg.version),
    __SFERE_BASE_VERSION__: JSON.stringify(base.version),
  },
  banner: { js: banner },
  tsconfig: "tsconfig.build.json",
});
