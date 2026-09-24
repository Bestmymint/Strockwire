import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/api/src/test/database-environment.test.ts"],
  },
});
