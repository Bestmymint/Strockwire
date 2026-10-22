import { defineConfig } from "vitest/config";

// Explicit database-free allowlist: no database setup, reset, or external mail.
export default defineConfig({
  test: {
    include: [
      "apps/api/src/modules/identity/email-provider.test.ts",
      "apps/api/src/modules/identity/verification-delivery.test.ts",
    ],
    fileParallelism: false,
  },
});
