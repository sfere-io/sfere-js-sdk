import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/test/e2e/.tmp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "packages/*/scripts/**/*.{js,mjs}",
      "packages/*/test/e2e/**/*.{js,mjs}",
      "**/*.config.{js,mjs,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
);
