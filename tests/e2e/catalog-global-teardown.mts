import { existsSync } from "node:fs";

import { loadTestDatabaseEnvironment } from "../../apps/api/src/test/database-environment.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../apps/api/src/test/database-harness.ts";

export default async function globalTeardown(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const environment = loadTestDatabaseEnvironment();
  const prisma = createTestPrismaClient(environment);
  try {
    await resetTestDatabase(environment);
  } finally {
    await prisma.$disconnect();
  }
}
