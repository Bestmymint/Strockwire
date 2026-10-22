import { defineConfig } from "vitest/config";
import baseline from "./vitest.config.mts";

// Root reset/migration setup receives only this invocation's newly owned target.
export default defineConfig({
  ...baseline,
  test: {
    ...baseline.test,
    include: [
      "apps/api/src/modules/identity/registration.integration.test.ts",
      "apps/api/src/modules/identity/authentication.integration.test.ts",
      "apps/api/src/modules/identity/credential-lifecycle.integration.test.ts",
      "apps/api/src/modules/identity/first-organization-onboarding.integration.test.ts",
      "apps/api/src/modules/identity/membership-access.integration.test.ts",
    ],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
