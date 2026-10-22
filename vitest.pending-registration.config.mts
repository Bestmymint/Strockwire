import { defineConfig } from "vitest/config";

// D3 only: no database provisioning, migrations, reset, or dotenv setup.
export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "apps/api/src/modules/identity/pending-registration-router.test.ts",
      "apps/api/src/modules/identity/pending-registration-service.test.ts",
    ],
  },
});
