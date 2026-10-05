import { defineConfig } from "@playwright/test";

import publicConfig from "./playwright.public.config";

// Browser UI/print layout checks with stubbed API responses; no database setup.
export default defineConfig({
  ...publicConfig,
  testMatch: "barcode-labels.browser.spec.ts",
  outputDir: "test-results/labels",
});
