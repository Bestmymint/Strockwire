import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadTestDatabaseEnvironment } from "./database-environment.ts";
import {
  applyTestDatabaseMigrations,
  provisionTestDatabase,
  resetTestDatabase,
} from "./database-harness.ts";

const environmentFile = fileURLToPath(
  new URL("../../../../.env", import.meta.url),
);

export default async function setupDatabaseTests(): Promise<
  () => Promise<void>
> {
  if (existsSync(environmentFile)) {
    process.loadEnvFile(environmentFile);
  }

  const environment = loadTestDatabaseEnvironment();
  await provisionTestDatabase(environment);
  await applyTestDatabaseMigrations(environment);
  await resetTestDatabase(environment);

  return async () => {
    await resetTestDatabase(environment);
  };
}
