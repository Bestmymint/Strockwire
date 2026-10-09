import { defineConfig } from "vitest/config";

// Deliberately no database global setup, provisioning, reset, or email delivery.
export default defineConfig({
  test: {
    include: [
      "apps/api/src/test/auth-integration-harness.test.ts",
      "apps/api/src/test/auth-integration-resources.test.ts",
      "apps/api/src/test/auth-integration-lifecycle.test.ts",
      "apps/api/src/test/auth-integration-startup.test.ts",
      "apps/api/src/test/auth-integration-artifacts.test.ts",
      "apps/api/src/test/auth-integration-f7.test.ts",
      "tests/e2e/auth-integration/successor-ui.test.ts",
      "apps/api/src/test/database-environment.test.ts",
      "apps/api/src/modules/identity/authentication-runtime.test.ts",
      "apps/api/src/modules/identity/verification-delivery.test.ts",
      "apps/api/src/modules/identity/verification-security.test.ts",
    ],
    fileParallelism: false,
  },
});
