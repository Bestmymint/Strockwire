import { defineConfig, devices } from "@playwright/test";

// Public routes and auth-entry navigation need only Next.js, with no database setup.
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: "./tests/e2e",
  testMatch: ["marketing.spec.ts", "preferences.browser.spec.ts"],
  outputDir: "test-results/public",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm start:web",
    env: { STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" },
    reuseExistingServer: false,
    timeout: 60_000,
    url: "http://localhost:3000",
  },
  workers: 1,
});
