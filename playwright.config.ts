import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const SITE_ORIGIN = "http://127.0.0.1:4310";
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./test/e2e/specs",
  outputDir: "./test-results",
  // mock-ingest.mjs keeps one shared, global request log for the whole run (reset per test via
  // /__reset) rather than a log per client — so specs must not run concurrently against it, or
  // one test's reset/read can race another test's in-flight request. One worker keeps every test
  // strictly sequential; the suite is small enough that this costs little in wall-clock time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: SITE_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node test/e2e/mock-ingest.mjs",
    url: `http://127.0.0.1:4311/__events`,
    reuseExistingServer: !isCI,
    timeout: 20_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  globalSetup: "./test/e2e/global-setup.ts",
});
