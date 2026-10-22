import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "apps/api/src/modules/identity/pending-registration.integration.test.ts",
      "apps/api/src/modules/identity/pending-registration-suppression.integration.test.ts",
    ],
    globalSetup: ["apps/api/src/test/database-global-setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
