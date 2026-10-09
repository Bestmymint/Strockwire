import { defineConfig, devices } from "@playwright/test";

// Prevent Playwright 1.62's automatic failure DOM snapshot before any fixture.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./tests/e2e/auth-integration",
  testMatch: "real-auth.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  forbidOnly: true,
  timeout: 45_000,
  outputDir: "test-results/auth-integration",
  reporter: "./tests/e2e/auth-integration/safe-reporter.ts",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: "http://localhost:3102",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "off",
    video: "off",
    screenshot: "off",
    acceptDownloads: false,
    serviceWorkers: "block",
  },
});
