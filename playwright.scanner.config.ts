import { defineConfig } from "@playwright/test";

import publicConfig from "./playwright.public.config";

// Real POS UI with controlled API/media responses; no database or physical camera.
export default defineConfig({
  ...publicConfig,
  testMatch: "pos-scanner.browser.spec.ts",
  outputDir: "test-results/scanner",
});
