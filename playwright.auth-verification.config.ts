import { defineConfig, devices } from "@playwright/test";

// Controlled browser mocks only: no API process, database setup, or mail delivery.
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: "./tests/e2e",
  testMatch: "auth-verification.browser.spec.ts",
  outputDir: "test-results/auth-verification",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  use: {
    baseURL: "http://localhost:3101",
    trace: "off",
    // The synthetic cross-origin parent must reach loopback documents so the
    // framing regression tests CSP, not Chromium's local-network permission.
    launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
  },
  webServer: {
    command: "pnpm --filter @stockwise/web exec next start --port 3101",
    env: { STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" },
    reuseExistingServer: false,
    timeout: 60_000,
    url: "http://localhost:3101",
  },
  workers: 1,
});
