import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __SFERE_SALLA_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: "happy-dom",
    // The integration injects the SDK <script>; tests assert on the tag, never fetch it.
    environmentOptions: {
      happyDOM: {
        settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
      },
    },
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
