import { loadTestDatabaseEnvironment } from "./database-environment.ts";
import {
  applyTestDatabaseMigrations,
  provisionTestDatabase,
  resetTestDatabase,
} from "./database-harness.ts";

export default async function setupDatabaseTests(): Promise<
  () => Promise<void>
> {
  const environment = loadTestDatabaseEnvironment();
  await provisionTestDatabase(environment);
  await applyTestDatabaseMigrations(environment);
  await resetTestDatabase(environment);

  return async () => {
    await resetTestDatabase(environment);
  };
}
