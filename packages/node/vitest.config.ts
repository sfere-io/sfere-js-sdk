import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};
const base = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve("@segment/analytics-node/package.json"),
    "utf8",
  ),
) as { version: string };

export default defineConfig({
  define: {
    __SFERE_VERSION__: JSON.stringify(pkg.version),
    __SFERE_BASE_VERSION__: JSON.stringify(base.version),
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { lines: 90 },
    },
  },
});
