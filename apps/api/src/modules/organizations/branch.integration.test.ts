import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { createPrismaAuthenticationSessionRepository } from "../identity/authentication-repository.ts";
import { createAuthenticationMiddleware } from "../identity/authentication-context.ts";
import type { SessionConfiguration } from "../identity/session-configuration.ts";
import { SESSION_COOKIE_NAME } from "../identity/session-cookie.ts";
import { hashSessionToken } from "../identity/session-token.ts";
import { branchCreateRequestSchema } from "./branch-schemas.ts";
import { createPrismaBranchRepository } from "./branch-repository.ts";
import { createBranchRouter } from "./branch-router.ts";
import { createBranchService } from "./branch-service.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const NOW = new Date();
const PASSWORD_HASH_FIXTURE =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$c2NoZW1hLXRlc3Q";
const DAY_MILLISECONDS = 86_400_000;
const configuration: SessionConfiguration = {
  absoluteTimeoutMilliseconds: 7 * DAY_MILLISECONDS,
  idleTimeoutMilliseconds: DAY_MILLISECONDS,
  secureCookie: false,
  touchIntervalMilliseconds: 900_000,
};

async function user(email: string) {
  return prisma.user.create({
    data: {
      email,
      emailVerifiedAt: NOW,
      passwordHash: PASSWORD_HASH_FIXTURE,
    },
  });
}

async function membership(
  organizationId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "BRANCH_MANAGER" | "INVENTORY_STAFF" | "CASHIER",
) {
  return prisma.organizationMembership.create({
    data: { organizationId, role, userId },
  });
}

describe("branch management with PostgreSQL", () => {
  const repository = createPrismaBranchRepository(prisma, () => NOW);
  let runningServer: RunningApiServer | undefined;

  beforeEach(async () => resetTestDatabase(environment));
  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });
  afterAll(async () => {
    await resetTestDatabase(environment);
    await prisma.$disconnect();
  });

  it("returns active authorized access and role-appropriate branch listings", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Store" },
    });
    const otherOrganization = await prisma.organization.create({
      data: { name: "Other Store" },
    });
    const owner = await user("owner-branches@example.com");
    const manager = await user("manager-branches@example.com");
    await membership(organization.id, owner.id, "OWNER");
    await membership(organization.id, manager.id, "BRANCH_MANAGER");
    const [activeA, activeB, inactive] = await Promise.all([
      prisma.branch.create({
        data: { code: "A", name: "A", organizationId: organization.id },
      }),
      prisma.branch.create({
        data: { code: "B", name: "B", organizationId: organization.id },
      }),
      prisma.branch.create({
        data: {
          code: "C",
          deactivatedAt: NOW,
          name: "C",
          organizationId: organization.id,
          status: "INACTIVE",
        },
      }),
      prisma.branch.create({
        data: {
          code: "OTHER",
          name: "Other",
          organizationId: otherOrganization.id,
        },
      }),
    ]);
    await Promise.all([
      prisma.branchAssignment.create({
        data: {
          branchId: activeB.id,
          organizationId: organization.id,
          userId: manager.id,
        },
      }),
      prisma.branchAssignment.create({
        data: {
          branchId: inactive.id,
          organizationId: organization.id,
          userId: manager.id,
        },
      }),
    ]);

    await expect(
      repository.list(owner.id, organization.id, false),
    ).resolves.toMatchObject({
      kind: "success",
      branches: [{ id: activeA.id }, { id: activeB.id }],
    });
    await expect(
      repository.list(owner.id, organization.id, true),
    ).resolves.toMatchObject({
      kind: "success",
      branches: [{ id: activeA.id }, { id: activeB.id }, { id: inactive.id }],
    });
    await expect(
      repository.list(manager.id, organization.id, false),
    ).resolves.toMatchObject({
      kind: "success",
      branches: [{ id: activeB.id }],
    });
    await expect(
      repository.list(manager.id, organization.id, true),
    ).resolves.toEqual({ kind: "forbidden" });
    await expect(repository.accessContext(manager.id)).resolves.toMatchObject({
      firstOrganizationOnboarding: { eligible: false },
      organizations: [
        { branches: [{ id: activeB.id }], role: "BRANCH_MANAGER" },
      ],
      user: { id: manager.id },
    });
  });

  it("derives first-organization eligibility from all memberships and onboarding provenance", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Eligibility Store" },
    });
    const branch = await prisma.branch.create({
      data: { code: "MAIN", name: "Main", organizationId: organization.id },
    });
    const issuer = await user("eligibility-issuer@example.com");
    const issuerMembership = await membership(
      organization.id,
      issuer.id,
      "OWNER",
    );
    const newUser = await user("eligibility-new@example.com");
    const invitedUser = await user("eligibility-invited@example.com");
    const activeUser = await user("eligibility-active@example.com");
    const inactiveUser = await user("eligibility-inactive@example.com");
    const onboardedUser = await user("eligibility-onboarded@example.com");

    await prisma.invitation.create({
      data: {
        expiresAt: new Date(NOW.getTime() + 7 * DAY_MILLISECONDS),
        intendedRole: "CASHIER",
        invitedEmail: invitedUser.email,
        issuedByMembershipId: issuerMembership.id,
        organizationId: organization.id,
        tokenHash: "access-context-pending-invitation",
      },
    });
    await membership(organization.id, activeUser.id, "CASHIER");
    await prisma.organizationMembership.create({
      data: {
        deactivatedAt: NOW,
        organizationId: organization.id,
        role: "CASHIER",
        status: "INACTIVE",
        userId: inactiveUser.id,
      },
    });
    await membership(organization.id, onboardedUser.id, "OWNER");
    await prisma.firstOrganizationOnboarding.create({
      data: {
        branchId: branch.id,
        organizationId: organization.id,
        requestHash: "a".repeat(64),
        userId: onboardedUser.id,
      },
    });
    await prisma.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: onboardedUser.id,
        },
      },
      data: { deactivatedAt: NOW, status: "INACTIVE" },
    });

    await expect(repository.accessContext(newUser.id)).resolves.toMatchObject({
      firstOrganizationOnboarding: { eligible: true },
      organizations: [],
    });
    await expect(
      repository.accessContext(invitedUser.id),
    ).resolves.toMatchObject({
      firstOrganizationOnboarding: { eligible: true },
      organizations: [],
    });
    await expect(
      repository.accessContext(activeUser.id),
    ).resolves.toMatchObject({
      firstOrganizationOnboarding: { eligible: false },
      organizations: [{ id: organization.id }],
    });
    await expect(
      repository.accessContext(inactiveUser.id),
    ).resolves.toMatchObject({
      firstOrganizationOnboarding: { eligible: false },
      organizations: [],
    });
    await expect(
      repository.accessContext(onboardedUser.id),
    ).resolves.toMatchObject({
      firstOrganizationOnboarding: { eligible: false },
      organizations: [],
    });
  });

  it("allows OWNER and ADMIN creation, rejects branch roles, and resolves concurrent code duplicates", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Store" },
    });
    const owner = await user("owner-create@example.com");
    const admin = await user("admin-create@example.com");
    const manager = await user("manager-create@example.com");
    await Promise.all([
      membership(organization.id, owner.id, "OWNER"),
      membership(organization.id, admin.id, "ADMIN"),
      membership(organization.id, manager.id, "BRANCH_MANAGER"),
    ]);
    const parsed = branchCreateRequestSchema.parse({
      code: "  main  ",
      name: "  Main  ",
    });

    const outcomes = await Promise.all([
      repository.create(owner.id, organization.id, parsed),
      repository.create(admin.id, organization.id, parsed),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "code_conflict",
      "success",
    ]);
    await expect(
      repository.create(
        manager.id,
        organization.id,
        branchCreateRequestSchema.parse({ code: "B", name: "B" }),
      ),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(await prisma.branch.findFirstOrThrow()).toMatchObject({
      code: "MAIN",
      name: "Main",
    });
  });

  it("enforces exact optimistic versions and immutable code", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Store" },
    });
    const owner = await user("owner-update@example.com");
    await membership(organization.id, owner.id, "OWNER");
    const branch = await prisma.branch.create({
      data: { code: "FIXED", name: "Before", organizationId: organization.id },
    });

    const first = await repository.update(
      owner.id,
      organization.id,
      branch.id,
      {
        expectedUpdatedAt: branch.updatedAt,
        name: "After",
      },
    );
    expect(first).toMatchObject({
      kind: "success",
      branch: { code: "FIXED", name: "After" },
    });
    await expect(
      repository.update(owner.id, organization.id, branch.id, {
        expectedUpdatedAt: branch.updatedAt,
        name: "Stale overwrite",
      }),
    ).resolves.toEqual({ kind: "stale" });
  });

  it("serializes deactivation, preserves assignments, and restores access after reactivation", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Store" },
    });
    const owner = await user("owner-lifecycle@example.com");
    const manager = await user("manager-lifecycle@example.com");
    await Promise.all([
      membership(organization.id, owner.id, "OWNER"),
      membership(organization.id, manager.id, "BRANCH_MANAGER"),
    ]);
    const [a, b] = await Promise.all([
      prisma.branch.create({
        data: { code: "A", name: "A", organizationId: organization.id },
      }),
      prisma.branch.create({
        data: { code: "B", name: "B", organizationId: organization.id },
      }),
    ]);
    await Promise.all([
      prisma.branchAssignment.create({
        data: {
          branchId: a.id,
          organizationId: organization.id,
          userId: manager.id,
        },
      }),
      prisma.branchAssignment.create({
        data: {
          branchId: b.id,
          organizationId: organization.id,
          userId: manager.id,
        },
      }),
    ]);

    const outcomes = await Promise.all([
      repository.setLifecycle({
        actorUserId: owner.id,
        branchId: a.id,
        expectedUpdatedAt: a.updatedAt,
        organizationId: organization.id,
        status: "INACTIVE",
      }),
      repository.setLifecycle({
        actorUserId: owner.id,
        branchId: b.id,
        expectedUpdatedAt: b.updatedAt,
        organizationId: organization.id,
        status: "INACTIVE",
      }),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "last_active_branch",
      "success",
    ]);
    expect(
      await prisma.branch.count({
        where: { organizationId: organization.id, status: "ACTIVE" },
      }),
    ).toBe(1);
    expect(await prisma.branchAssignment.count()).toBe(2);

    const inactive = await prisma.branch.findFirstOrThrow({
      where: { organizationId: organization.id, status: "INACTIVE" },
    });
    const accessWhileInactive = await repository.accessContext(manager.id);
    expect(accessWhileInactive?.organizations[0]?.branches).toHaveLength(1);
    expect(accessWhileInactive?.organizations[0]?.branches[0]?.id).not.toBe(
      inactive.id,
    );
    const reactivated = await repository.setLifecycle({
      actorUserId: owner.id,
      branchId: inactive.id,
      expectedUpdatedAt: inactive.updatedAt,
      organizationId: organization.id,
      status: "ACTIVE",
    });
    if (reactivated.kind !== "success") {
      throw new Error("Expected branch reactivation to succeed.");
    }
    const repeated = await repository.setLifecycle({
      actorUserId: owner.id,
      branchId: inactive.id,
      expectedUpdatedAt: new Date(reactivated.branch.updatedAt),
      organizationId: organization.id,
      status: "ACTIVE",
    });
    expect(repeated).toEqual(reactivated);
    const accessAfterReactivation = await repository.accessContext(manager.id);
    expect(accessAfterReactivation?.organizations[0]?.branches).toHaveLength(2);
  });

  it("revokes branch navigation through the real authenticated HTTP stack", async () => {
    const organization = await prisma.organization.create({
      data: { name: "HTTP Store" },
    });
    const owner = await user("owner-http@example.com");
    await membership(organization.id, owner.id, "OWNER");
    const main = await prisma.branch.create({
      data: { code: "MAIN", name: "Main", organizationId: organization.id },
    });
    const rawToken = "H".repeat(43);
    await prisma.session.create({
      data: {
        absoluteExpiresAt: new Date(NOW.getTime() + 7 * DAY_MILLISECONDS),
        idleExpiresAt: new Date(NOW.getTime() + DAY_MILLISECONDS),
        issuedAt: NOW,
        lastUsedAt: NOW,
        tokenHash: hashSessionToken(rawToken),
        userId: owner.id,
      },
    });
    const authenticationMiddleware = createAuthenticationMiddleware({
      configuration,
      now: () => NOW,
      repository: createPrismaAuthenticationSessionRepository(prisma),
    });
    const apiRouter = createBranchRouter({
      authenticationMiddleware,
      branchService: createBranchService({ repository }),
      publicWebOrigin: "http://localhost:3000",
    });
    const logger: ApiLogger = { error() {}, info() {} };
    runningServer = await startApiServer(createApp({ apiRouter, logger }), {
      host: "127.0.0.1",
      port: 0,
    });
    const base = `http://${runningServer.address.host}:${runningServer.address.port}/api/v1`;
    const headers = {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
      origin: "http://localhost:3000",
    };

    const createdResponse = await fetch(
      `${base}/organizations/${organization.id}/branches`,
      {
        body: JSON.stringify({ code: "  second  ", name: "Second" }),
        headers,
        method: "POST",
      },
    );
    const created = (await createdResponse.json()) as {
      data: { code: string; id: string };
    };
    expect(createdResponse.status).toBe(201);
    expect(created.data.code).toBe("SECOND");

    const deactivatedResponse = await fetch(
      `${base}/organizations/${organization.id}/branches/${main.id}/deactivate`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: main.updatedAt.toISOString(),
        }),
        headers,
        method: "POST",
      },
    );
    expect(deactivatedResponse.status).toBe(200);

    const accessResponse = await fetch(`${base}/me/access-context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` },
    });
    const access = (await accessResponse.json()) as {
      data: { organizations: Array<{ branches: Array<{ id: string }> }> };
    };
    expect(accessResponse.status).toBe(200);
    expect(access.data.organizations[0]?.branches).toEqual([
      expect.objectContaining({ id: created.data.id }),
    ]);
  });
});
