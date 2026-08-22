import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../test/database-environment.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);

const PASSWORD_HASH_FIXTURE =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$c2NoZW1hLXRlc3Q";

function futureHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function createUser(email: string, displayName = "Schema Test User") {
  return prisma.user.create({
    data: {
      email,
      passwordHash: PASSWORD_HASH_FIXTURE,
      displayName,
    },
  });
}

async function createOrganization(name: string) {
  return prisma.organization.create({ data: { name } });
}

async function createBranch(organizationId: string, code: string) {
  return prisma.branch.create({
    data: {
      organizationId,
      code,
      name: `${code} Branch`,
    },
  });
}

describe("identity and tenancy database schema", () => {
  beforeEach(async () => {
    await resetTestDatabase(environment);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await resetTestDatabase(environment);
  });

  it("applies the reviewed identity and tenancy migration", async () => {
    const migrations = await prisma.$queryRaw<
      { migrationName: string; finished: boolean; active: boolean }[]
    >`
      SELECT
        migration_name AS "migrationName",
        finished_at IS NOT NULL AS finished,
        rolled_back_at IS NULL AS active
      FROM "_prisma_migrations"
      ORDER BY started_at
    `;
    const tables = await prisma.$queryRaw<{ tableName: string }[]>`
      SELECT tablename AS "tableName"
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;

    expect(migrations).toEqual([
      {
        migrationName: "20260822104545_identity_tenancy_schema",
        finished: true,
        active: true,
      },
    ]);
    expect(tables.map(({ tableName }) => tableName)).toEqual([
      "branch_assignments",
      "branches",
      "email_verification_tokens",
      "invitation_branch_scopes",
      "invitations",
      "organization_memberships",
      "organizations",
      "password_reset_tokens",
      "sessions",
      "users",
    ]);
  });

  it("creates tenant-safe multi-organization and multi-branch relationships", async () => {
    const user = await createUser("multi-scope@example.com");
    const firstOrganization = await createOrganization("First Organization");
    const secondOrganization = await createOrganization("Second Organization");
    const firstBranch = await createBranch(firstOrganization.id, "FIRST");
    const secondBranch = await createBranch(firstOrganization.id, "SECOND");

    await prisma.organizationMembership.createMany({
      data: [
        {
          organizationId: firstOrganization.id,
          userId: user.id,
          role: "BRANCH_MANAGER",
        },
        {
          organizationId: secondOrganization.id,
          userId: user.id,
          role: "ADMIN",
        },
      ],
    });
    await prisma.branchAssignment.createMany({
      data: [
        {
          organizationId: firstOrganization.id,
          userId: user.id,
          branchId: firstBranch.id,
        },
        {
          organizationId: firstOrganization.id,
          userId: user.id,
          branchId: secondBranch.id,
        },
      ],
    });

    expect(
      await prisma.organizationMembership.count({ where: { userId: user.id } }),
    ).toBe(2);
    expect(
      await prisma.branchAssignment.count({ where: { userId: user.id } }),
    ).toBe(2);
  });

  it("enforces canonical globally unique user email storage", async () => {
    await createUser("unique@example.com");

    await expect(
      createUser("unique@example.com", "Duplicate User"),
    ).rejects.toThrow();
    await expect(
      createUser(" Unique@Example.com ", "Unnormalized User"),
    ).rejects.toThrow();
  });

  it("rejects duplicate organization memberships", async () => {
    const user = await createUser("member@example.com");
    const organization = await createOrganization("Membership Organization");

    await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "CASHIER",
      },
    });

    await expect(
      prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: "ADMIN",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows organization-wide roles without branch assignments", async () => {
    const owner = await createUser("owner@example.com", "Owner");
    const admin = await createUser("admin@example.com", "Admin");
    const organization = await createOrganization("Organization-wide Roles");
    await createBranch(organization.id, "MAIN");

    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: organization.id, userId: owner.id, role: "OWNER" },
        { organizationId: organization.id, userId: admin.id, role: "ADMIN" },
      ],
    });

    expect(
      await prisma.organizationMembership.count({
        where: { organizationId: organization.id, status: "ACTIVE" },
      }),
    ).toBe(2);
    expect(
      await prisma.branchAssignment.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(0);
  });

  it("rejects duplicate and cross-organization branch assignments", async () => {
    const user = await createUser("branch-user@example.com");
    const firstOrganization = await createOrganization(
      "Assignment Organization A",
    );
    const secondOrganization = await createOrganization(
      "Assignment Organization B",
    );
    const firstBranch = await createBranch(firstOrganization.id, "A");
    const secondBranch = await createBranch(secondOrganization.id, "B");

    await prisma.organizationMembership.create({
      data: {
        organizationId: firstOrganization.id,
        userId: user.id,
        role: "INVENTORY_STAFF",
      },
    });
    await prisma.branchAssignment.create({
      data: {
        organizationId: firstOrganization.id,
        userId: user.id,
        branchId: firstBranch.id,
      },
    });

    await expect(
      prisma.branchAssignment.create({
        data: {
          organizationId: firstOrganization.id,
          userId: user.id,
          branchId: firstBranch.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.branchAssignment.create({
        data: {
          organizationId: firstOrganization.id,
          userId: user.id,
          branchId: secondBranch.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects cross-organization invitation branch scope", async () => {
    const firstOrganization = await createOrganization(
      "Invitation Organization A",
    );
    const secondOrganization = await createOrganization(
      "Invitation Organization B",
    );
    const validBranch = await createBranch(firstOrganization.id, "A");
    const crossTenantBranch = await createBranch(secondOrganization.id, "B");
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: firstOrganization.id,
        invitedEmail: "invitee@example.com",
        intendedRole: "BRANCH_MANAGER",
        tokenHash: "invitation-hash-a",
        expiresAt: futureHours(7 * 24),
      },
    });

    await prisma.invitationBranchScope.create({
      data: {
        organizationId: firstOrganization.id,
        invitationId: invitation.id,
        branchId: validBranch.id,
      },
    });
    await expect(
      prisma.invitationBranchScope.create({
        data: {
          organizationId: firstOrganization.id,
          invitationId: invitation.id,
          branchId: crossTenantBranch.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("binds invitation acceptance to the invited normalized email", async () => {
    const organization = await createOrganization("Email-bound Invitation");
    const wrongUser = await createUser("other-user@example.com");
    const invitedUser = await createUser("invited-user@example.com");
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        invitedEmail: invitedUser.email,
        intendedRole: "CASHIER",
        tokenHash: "email-bound-invitation-hash",
        expiresAt: futureHours(7 * 24),
      },
    });

    await expect(
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedByUserId: wrongUser.id, consumedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedByUserId: invitedUser.id, consumedAt: new Date() },
      }),
    ).resolves.toMatchObject({ acceptedByUserId: invitedUser.id });
  });

  it("enforces session and one-time token hash uniqueness", async () => {
    const user = await createUser("tokens@example.com");
    const secondUser = await createUser("tokens-two@example.com");

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: "session-hash",
        idleExpiresAt: futureHours(24),
        absoluteExpiresAt: futureHours(7 * 24),
      },
    });
    await expect(
      prisma.session.create({
        data: {
          userId: secondUser.id,
          tokenHash: "session-hash",
          idleExpiresAt: futureHours(24),
          absoluteExpiresAt: futureHours(7 * 24),
        },
      }),
    ).rejects.toThrow();

    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: "verification-hash",
        expiresAt: futureHours(24),
      },
    });
    await expect(
      prisma.emailVerificationToken.create({
        data: {
          userId: secondUser.id,
          tokenHash: "verification-hash",
          expiresAt: futureHours(24),
        },
      }),
    ).rejects.toThrow();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: "reset-hash",
        expiresAt: futureHours(0.5),
      },
    });
    await expect(
      prisma.passwordResetToken.create({
        data: {
          userId: secondUser.id,
          tokenHash: "reset-hash",
          expiresAt: futureHours(0.5),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid session and one-time-token time ordering", async () => {
    const user = await createUser("time-ordering@example.com");
    const issuedAt = new Date();

    await expect(
      prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: "invalid-session-time-order",
          issuedAt,
          lastUsedAt: futureHours(2),
          idleExpiresAt: futureHours(1),
          absoluteExpiresAt: futureHours(7 * 24),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: "invalid-reset-time-order",
          issuedAt,
          expiresAt: futureHours(0.5),
          consumedAt: futureHours(1),
        },
      }),
    ).rejects.toThrow();
  });

  it("represents verification and invitation replacement without deleting history", async () => {
    const user = await createUser("replacement@example.com");
    const organization = await createOrganization("Replacement Organization");
    const verification = await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: "verification-original",
        expiresAt: futureHours(24),
      },
    });
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        invitedEmail: user.email,
        intendedRole: "CASHIER",
        tokenHash: "invitation-original",
        expiresAt: futureHours(7 * 24),
      },
    });

    await expect(
      prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: "verification-overlap",
          expiresAt: futureHours(24),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.invitation.create({
        data: {
          organizationId: organization.id,
          invitedEmail: user.email,
          intendedRole: "BRANCH_MANAGER",
          tokenHash: "invitation-overlap",
          expiresAt: futureHours(7 * 24),
        },
      }),
    ).rejects.toThrow();

    const replacedAt = new Date();
    await prisma.$transaction([
      prisma.emailVerificationToken.update({
        where: { id: verification.id },
        data: { replacedAt },
      }),
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { replacedAt },
      }),
    ]);
    await expect(
      prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: "verification-replacement",
          expiresAt: futureHours(24),
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.invitation.create({
        data: {
          organizationId: organization.id,
          invitedEmail: user.email,
          intendedRole: "BRANCH_MANAGER",
          tokenHash: "invitation-replacement",
          expiresAt: futureHours(7 * 24),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("restricts hard deletion of referenced identity and tenancy records", async () => {
    const user = await createUser("history@example.com");
    const organization = await createOrganization("History Organization");
    const branch = await createBranch(organization.id, "HISTORY");
    await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "CASHIER",
      },
    });
    await prisma.branchAssignment.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        branchId: branch.id,
      },
    });

    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.organization.delete({ where: { id: organization.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.branch.delete({ where: { id: branch.id } }),
    ).rejects.toThrow();
  });
});
