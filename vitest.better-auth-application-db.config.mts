import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "apps/api/src/modules/identity/better-auth-application-session.integration.test.ts",
      "apps/api/src/modules/identity/better-auth-password-reset.integration.test.ts",
      "apps/api/src/modules/identity/native-password-reset-limiter.integration.test.ts",
    ],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
