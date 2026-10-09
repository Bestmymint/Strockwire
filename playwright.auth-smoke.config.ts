import { defineConfig, devices } from "@playwright/test";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// Database-free frontend mocks; no API process or disabled browser protections.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "auth-verification.browser.spec.ts",
    "auth-integration/safe-ui.spec.ts",
  ],
  grep: /long email wraps|link entry never serializes|abandoning or reloading|delayed resend|password proof|safe auth surfaces/,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  reporter: "./tests/e2e/auth-integration/safe-reporter.ts",
  outputDir: "test-results/auth-smoke",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: "http://localhost:3101",
    trace: "off",
    video: "off",
    screenshot: "off",
    acceptDownloads: false,
  },
  webServer: {
    cwd: "apps/web",
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3101",
    env: {
      STOCKWISE_API_ORIGIN: "http://127.0.0.1:3103",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: false,
    timeout: 60_000,
    url: "http://localhost:3101",
    stdout: "ignore",
    stderr: "ignore",
  },
});
