import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const aNext = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve("@segment/analytics-next/package.json"),
    "utf8",
  ),
) as { version: string };

export default defineConfig({
  resolve: {
    // src/react.ts imports the package by name; tests run it against the source.
    alias: [
      {
        find: /^@fanfinity\/sfere-sdk$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
    ],
  },
  define: {
    __SFERE_VERSION__: JSON.stringify(pkg.version),
    __SFERE_BASE_VERSION__: JSON.stringify(aNext.version),
  },
  test: {
    environment: "happy-dom",
    include: ["test/unit/**/*.test.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/events.ts"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { lines: 90 },
    },
  },
});
