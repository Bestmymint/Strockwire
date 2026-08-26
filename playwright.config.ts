import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env");

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for Playwright E2E tests.");
}

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  globalSetup: "./tests/e2e/catalog-global-setup.mts",
  globalTeardown: "./tests/e2e/catalog-global-teardown.mts",
  outputDir: "test-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: process.env.CI ? "github" : "list",
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm start:api",
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
        STOCKWISE_RUNTIME_ENV: "test",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3001/ready",
    },
    {
      command: "pnpm dev:web",
      env: {
        ...process.env,
        STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://localhost:3000/api/health",
    },
  ],
  workers: 1,
});
