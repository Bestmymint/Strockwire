import { defineConfig, devices } from "@playwright/test";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./tests/e2e/better-auth-integration",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 0,
  forbidOnly: true,
  timeout: 60_000,
  outputDir: "test-results/better-auth-integration",
  reporter: "./tests/e2e/better-auth-integration/reporter.ts",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: "http://localhost:3202",
    // Full Chromium supports BFCache; the default headless shell disables it.
    channel: "chromium",
    // Native tab focus events are required; headless activation is not desktop focus.
    headless: false,
    launchOptions: {
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
    },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "off",
    video: "off",
    screenshot: "off",
    acceptDownloads: false,
    serviceWorkers: "block",
  },
});
