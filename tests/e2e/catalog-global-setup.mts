import { existsSync } from "node:fs";

import { hashPassword } from "../../apps/api/src/modules/identity/password-hasher.ts";
import { loadTestDatabaseEnvironment } from "../../apps/api/src/test/database-environment.ts";
import {
  applyTestDatabaseMigrations,
  createTestPrismaClient,
  provisionTestDatabase,
  resetTestDatabase,
} from "../../apps/api/src/test/database-harness.ts";
import {
  E2E_BRANCH_ID,
  E2E_CASHIER_EMAIL,
  E2E_CASHIER_ID,
  E2E_ORGANIZATION_ID,
  E2E_OWNER_EMAIL,
  E2E_OWNER_ID,
  E2E_PASSWORD,
} from "./catalog-fixtures.ts";

export default async function globalSetup(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const environment = loadTestDatabaseEnvironment();
  await provisionTestDatabase(environment);
  await applyTestDatabaseMigrations(environment);
  const prisma = createTestPrismaClient(environment);

  try {
    await resetTestDatabase(environment);
    const passwordHash = await hashPassword(E2E_PASSWORD);
    await prisma.organization.create({
      data: { id: E2E_ORGANIZATION_ID, name: "Catalog E2E Store" },
    });
    await prisma.branch.create({
      data: {
        code: "MAIN",
        id: E2E_BRANCH_ID,
        name: "Main branch",
        organizationId: E2E_ORGANIZATION_ID,
      },
    });
    await prisma.user.create({
      data: {
        displayName: "Catalog Owner",
        email: E2E_OWNER_EMAIL,
        emailVerifiedAt: new Date("2026-08-26T12:00:00.000Z"),
        id: E2E_OWNER_ID,
        passwordHash,
      },
    });
    await prisma.user.create({
      data: {
        displayName: "Catalog Cashier",
        email: E2E_CASHIER_EMAIL,
        emailVerifiedAt: new Date("2026-08-26T12:00:00.000Z"),
        id: E2E_CASHIER_ID,
        passwordHash,
      },
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          organizationId: E2E_ORGANIZATION_ID,
          role: "OWNER",
          userId: E2E_OWNER_ID,
        },
        {
          organizationId: E2E_ORGANIZATION_ID,
          role: "CASHIER",
          userId: E2E_CASHIER_ID,
        },
      ],
    });
    await prisma.branchAssignment.create({
      data: {
        branchId: E2E_BRANCH_ID,
        organizationId: E2E_ORGANIZATION_ID,
        userId: E2E_CASHIER_ID,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
