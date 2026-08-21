import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

const environmentFile = fileURLToPath(new URL("../../.env", import.meta.url));

if (existsSync(environmentFile)) {
  process.loadEnvFile(environmentFile);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(process.env.DATABASE_URL === undefined
    ? {}
    : { datasource: { url: process.env.DATABASE_URL } }),
});
