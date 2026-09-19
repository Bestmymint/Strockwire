import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPrismaClient,
  resetTestDatabase,
  withRollbackTransaction,
} from "../../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/20260920120000_add_organization_reporting_timezone/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Organization reporting timezone migration", () => {
  beforeEach(async () => {
    await resetTestDatabase(environment);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await resetTestDatabase(environment);
  });

  it("backfills an existing Organization to Asia/Bangkok", async () => {
    await withRollbackTransaction(prisma, async (transaction) => {
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "organizations" DROP COLUMN "reporting_timezone"',
      );
      await transaction.$executeRawUnsafe(`
        INSERT INTO "organizations" ("id", "name", "created_at", "updated_at")
        VALUES (
          '11111111-1111-4111-8111-111111111111',
          'Legacy Organization',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `);
      await transaction.$executeRawUnsafe(migration);

      const rows = await transaction.$queryRawUnsafe<
        { reportingTimezone: string }[]
      >(`
        SELECT "reporting_timezone" AS "reportingTimezone"
        FROM "organizations"
        WHERE "id" = '11111111-1111-4111-8111-111111111111'
      `);

      expect(rows).toEqual([{ reportingTimezone: "Asia/Bangkok" }]);
    });
  });
});
