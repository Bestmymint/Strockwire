import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaBranchRepository } from "../organizations/branch-repository.ts";
import {
  createRecordingEmailProvider,
  type IdentityEmailProvider,
} from "./email-provider.ts";
import type { RecordingIdentityEmailProvider } from "./email-provider.ts";
import { createPrismaMembershipAccessRepository } from "./membership-access-repository.ts";
import { createMembershipAccessService } from "./membership-access-service.ts";
import { secureOneTimeTokenProvider } from "./one-time-token.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const NOW = new Date("2026-08-24T18:00:00.000Z");
const PASSWORD_HASH_FIXTURE =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$c2NoZW1hLXRlc3Q";

async function user(email: string) {
  return prisma.user.create({
    data: {
      displayName: email.split("@")[0]!,
      email,
      emailVerifiedAt: new Date(NOW.getTime() - 1_000),
      passwordHash: PASSWORD_HASH_FIXTURE,
    },
  });
}

async function organization(name = "Membership Store") {
  return prisma.organization.create({ data: { name } });
}

async function branch(organizationId: string, code: string) {
  return prisma.branch.create({
    data: { code, name: `${code} Branch`, organizationId },
  });
}

async function membership(
  organizationId: string,
  actor: Awaited<ReturnType<typeof user>>,
  role: "OWNER" | "ADMIN" | "BRANCH_MANAGER" | "INVENTORY_STAFF" | "CASHIER",
  status: "ACTIVE" | "INACTIVE" = "ACTIVE",
) {
  return prisma.organizationMembership.create({
    data: {
      deactivatedAt: status === "INACTIVE" ? NOW : null,
      organizationId,
      role,
      status,
      userId: actor.id,
    },
  });
}

function service(
  emailProvider: IdentityEmailProvider = createRecordingEmailProvider(),
  now = () => NOW,
) {
  return {
    emailProvider,
    value: createMembershipAccessService({
      emailProvider,
      now,
      publicWebOrigin: "http://localhost:3000",
      repository: createPrismaMembershipAccessRepository(prisma),
      tokenProvider: secureOneTimeTokenProvider,
    }),
  };
}

function invitationToken(provider: RecordingIdentityEmailProvider): string {
  const message = provider.messages.at(-1);
  if (message === undefined) throw new Error("Invitation message missing.");
  const token = new URL(message.url).searchParams.get("token");
  if (token === null) throw new Error("Invitation token missing.");
  return token;
}

describe("membership invitation and access management with PostgreSQL", () => {
  beforeEach(async () => {
    await resetTestDatabase(environment);
  });

  afterAll(async () => {
    await resetTestDatabase(environment);
    await prisma.$disconnect();
  });

  it("enforces invitation delegation, branch cardinality, tenant scope, and existing-member rejection", async () => {
    const store = await organization();
    const otherStore = await organization("Other Store");
    const main = await branch(store.id, "MAIN");
    const inactive = await branch(store.id, "OLD");
    await prisma.branch.update({
      where: { id: inactive.id },
      data: { deactivatedAt: NOW, status: "INACTIVE" },
    });
    const foreign = await branch(otherStore.id, "FOREIGN");
    const ownerUser = await user("owner@example.com");
    const adminUser = await user("admin@example.com");
    const managerUser = await user("manager@example.com");
    await membership(store.id, ownerUser, "OWNER");
    await membership(store.id, adminUser, "ADMIN");
    await membership(store.id, managerUser, "BRANCH_MANAGER");
    const { value } = service();

    await expect(
      value.createInvitation({
        actorUserId: ownerUser.id,
        invitation: {
          branchIds: [],
          email: "new-owner@example.com",
          role: "OWNER",
        },
        organizationId: store.id,
      }),
    ).resolves.toMatchObject({ kind: "success" });
    await expect(
      value.createInvitation({
        actorUserId: adminUser.id,
        invitation: {
          branchIds: [],
          email: "blocked-owner@example.com",
          role: "OWNER",
        },
        organizationId: store.id,
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    await expect(
      value.createInvitation({
        actorUserId: managerUser.id,
        invitation: {
          branchIds: [main.id],
          email: "blocked@example.com",
          role: "CASHIER",
        },
        organizationId: store.id,
      }),
    ).resolves.toEqual({ kind: "forbidden" });

    for (const branchIds of [[], [inactive.id], [foreign.id]]) {
      await expect(
        value.createInvitation({
          actorUserId: ownerUser.id,
          invitation: {
            branchIds,
            email: `${branchIds.length}-${branchIds[0] ?? "none"}@example.com`,
            role: "CASHIER",
          },
          organizationId: store.id,
        }),
      ).resolves.toEqual({ kind: "invalid_branch_scope" });
    }
    await expect(
      value.createInvitation({
        actorUserId: ownerUser.id,
        invitation: {
          branchIds: [main.id],
          email: "admin-scope@example.com",
          role: "ADMIN",
        },
        organizationId: store.id,
      }),
    ).resolves.toEqual({ kind: "invalid_branch_scope" });

    const existing = await user("existing@example.com");
    await membership(store.id, existing, "CASHIER", "INACTIVE");
    await expect(
      value.createInvitation({
        actorUserId: ownerUser.id,
        invitation: {
          branchIds: [main.id],
          email: existing.email,
          role: "CASHIER",
        },
        organizationId: store.id,
      }),
    ).resolves.toEqual({ kind: "membership_exists" });
  });

  it("reissues with a fresh token, preserves replacement history, compensates delivery failure, and revokes safely", async () => {
    const store = await organization();
    const ownerUser = await user("owner@example.com");
    const adminUser = await user("admin@example.com");
    await membership(store.id, ownerUser, "OWNER");
    await membership(store.id, adminUser, "ADMIN");
    const recording = createRecordingEmailProvider();
    const working = service(recording).value;

    await working.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [],
        email: "invitee@example.com",
        role: "ADMIN",
      },
      organizationId: store.id,
    });
    const firstToken = invitationToken(recording);
    await working.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [],
        email: "invitee@example.com",
        role: "ADMIN",
      },
      organizationId: store.id,
    });
    const secondToken = invitationToken(recording);
    expect(secondToken).not.toBe(firstToken);
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(invitations).toHaveLength(2);
    expect(invitations[0]).toMatchObject({
      replacedAt: NOW,
      revocationReason: "REPLACED",
    });
    expect(invitations[0]?.tokenHash).not.toBe(firstToken);

    const failed = service({
      async send() {
        throw new Error("provider");
      },
    }).value;
    await expect(
      failed.createInvitation({
        actorUserId: ownerUser.id,
        invitation: {
          branchIds: [],
          email: "failed@example.com",
          role: "ADMIN",
        },
        organizationId: store.id,
      }),
    ).resolves.toEqual({ kind: "delivery_failed" });
    expect(
      await prisma.invitation.findFirst({
        where: { invitedEmail: "failed@example.com" },
      }),
    ).toMatchObject({ revocationReason: "DELIVERY_FAILED", revokedAt: NOW });

    const ownerInvite = await working.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [],
        email: "owner-two@example.com",
        role: "OWNER",
      },
      organizationId: store.id,
    });
    if (ownerInvite.kind !== "success") throw new Error("Expected invitation.");
    await expect(
      working.revokeInvitation({
        actorUserId: adminUser.id,
        invitationId: ownerInvite.invitationId,
        organizationId: store.id,
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    await expect(
      working.revokeInvitation({
        actorUserId: ownerUser.id,
        invitationId: ownerInvite.invitationId,
        organizationId: store.id,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      invitation: { state: "REVOKED" },
    });
  });

  it("serializes concurrent reissue and invitation lifecycle races", async () => {
    const store = await organization();
    const ownerUser = await user("owner@example.com");
    await membership(store.id, ownerUser, "OWNER");
    const invitedUser = await user("race-invitee@example.com");
    const recording = createRecordingEmailProvider();
    const access = service(recording).value;
    const invitationInput = {
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [],
        email: invitedUser.email,
        role: "ADMIN" as const,
      },
      organizationId: store.id,
    };

    const issued = await Promise.all(
      Array.from({ length: 4 }, () => access.createInvitation(invitationInput)),
    );
    expect(issued.every(({ kind }) => kind === "success")).toBe(true);
    expect(
      await prisma.invitation.count({
        where: {
          consumedAt: null,
          invitedEmail: invitedUser.email,
          organizationId: store.id,
          replacedAt: null,
          revokedAt: null,
        },
      }),
    ).toBe(1);
    expect(
      new Set(
        recording.messages.map(({ url }) =>
          new URL(url).searchParams.get("token"),
        ),
      ).size,
    ).toBe(4);

    const activeToken = invitationToken(recording);
    const [acceptOutcome, reissueOutcome] = await Promise.all([
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: activeToken,
      }),
      access.createInvitation(invitationInput),
    ]);
    expect(
      (acceptOutcome.kind === "success" &&
        reissueOutcome.kind === "membership_exists") ||
        (acceptOutcome.kind === "invalid_invitation" &&
          reissueOutcome.kind === "success"),
    ).toBe(true);

    if (reissueOutcome.kind === "success") {
      const newestToken = invitationToken(recording);
      const [revokeOutcome, newestAcceptOutcome] = await Promise.all([
        access.revokeInvitation({
          actorUserId: ownerUser.id,
          invitationId: reissueOutcome.invitationId,
          organizationId: store.id,
        }),
        access.acceptInvitation({
          actorEmail: invitedUser.email,
          actorUserId: invitedUser.id,
          rawToken: newestToken,
        }),
      ]);
      expect(
        (revokeOutcome.kind === "success" &&
          newestAcceptOutcome.kind === "invalid_invitation") ||
          (revokeOutcome.kind === "finalized" &&
            newestAcceptOutcome.kind === "success"),
      ).toBe(true);
    }
  });

  it("accepts once, persists tenant-safe provenance and assignment scope, and reconciles same-user replay", async () => {
    const store = await organization();
    const main = await branch(store.id, "MAIN");
    const ownerUser = await user("owner@example.com");
    await membership(store.id, ownerUser, "OWNER");
    const invitedUser = await user("cashier@example.com");
    const recording = createRecordingEmailProvider();
    const access = service(recording).value;
    await access.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [main.id],
        email: invitedUser.email,
        role: "CASHIER",
      },
      organizationId: store.id,
    });
    const token = invitationToken(recording);

    await expect(
      access.acceptInvitation({
        actorEmail: "wrong@example.com",
        actorUserId: invitedUser.id,
        rawToken: token,
      }),
    ).resolves.toEqual({ kind: "invalid_invitation" });
    const accepted = await access.acceptInvitation({
      actorEmail: invitedUser.email,
      actorUserId: invitedUser.id,
      rawToken: token,
    });
    expect(accepted).toMatchObject({ kind: "success", replayed: false });
    if (accepted.kind !== "success") throw new Error("Expected acceptance.");
    const persisted = await prisma.organizationMembership.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: store.id,
          userId: invitedUser.id,
        },
      },
      include: {
        branchAssignments: true,
        sourceInvitation: true,
        targetAccessEvents: { include: { branchScopes: true } },
      },
    });
    expect(persisted.sourceInvitationId).not.toBeNull();
    expect(persisted.branchAssignments).toMatchObject([
      { branchId: main.id, status: "ACTIVE" },
    ]);
    expect(persisted.targetAccessEvents).toMatchObject([
      {
        eventType: "INVITATION_ACCEPTED",
        branchScopes: [{ branchId: main.id, organizationId: store.id }],
      },
    ]);
    await expect(
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: token,
      }),
    ).resolves.toMatchObject({ kind: "success", replayed: true });
    expect(await prisma.organizationMembership.count()).toBe(2);
    expect(await prisma.membershipAccessEvent.count()).toBe(1);
  });

  it("does not consume an invitation with stale branch scope and serializes concurrent acceptance", async () => {
    const store = await organization();
    const main = await branch(store.id, "MAIN");
    const ownerUser = await user("owner@example.com");
    await membership(store.id, ownerUser, "OWNER");
    const invitedUser = await user("staff@example.com");
    const recording = createRecordingEmailProvider();
    const access = service(recording).value;
    await access.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [main.id],
        email: invitedUser.email,
        role: "INVENTORY_STAFF",
      },
      organizationId: store.id,
    });
    const token = invitationToken(recording);
    await prisma.branch.update({
      where: { id: main.id },
      data: { deactivatedAt: NOW, status: "INACTIVE" },
    });
    await expect(
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: token,
      }),
    ).resolves.toEqual({ kind: "invalid_scope" });
    expect(await prisma.invitation.findFirstOrThrow()).toMatchObject({
      consumedAt: null,
    });
    await prisma.branch.update({
      where: { id: main.id },
      data: { deactivatedAt: null, status: "ACTIVE" },
    });
    const outcomes = await Promise.all([
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: token,
      }),
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: token,
      }),
    ]);
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: "success" }),
      expect.objectContaining({ kind: "success" }),
    ]);
    expect(await prisma.organizationMembership.count()).toBe(2);
    expect(await prisma.membershipAccessEvent.count()).toBe(1);
  });

  it("uses one generic invalid result for unknown, expired, revoked, and wrong-user invitation tokens", async () => {
    const store = await organization();
    const ownerUser = await user("owner@example.com");
    await membership(store.id, ownerUser, "OWNER");
    const invitedUser = await user("invalid-invitee@example.com");
    const otherUser = await user("other-invitee@example.com");
    const recording = createRecordingEmailProvider();
    const access = service(recording).value;

    await expect(
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: "unknown-token",
      }),
    ).resolves.toEqual({ kind: "invalid_invitation" });

    const created = await access.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [],
        email: invitedUser.email,
        role: "ADMIN",
      },
      organizationId: store.id,
    });
    if (created.kind !== "success") throw new Error("Expected invitation.");
    const token = invitationToken(recording);
    await expect(
      access.acceptInvitation({
        actorEmail: otherUser.email,
        actorUserId: otherUser.id,
        rawToken: token,
      }),
    ).resolves.toEqual({ kind: "invalid_invitation" });
    await access.revokeInvitation({
      actorUserId: ownerUser.id,
      invitationId: created.invitationId,
      organizationId: store.id,
    });
    await expect(
      access.acceptInvitation({
        actorEmail: invitedUser.email,
        actorUserId: invitedUser.id,
        rawToken: token,
      }),
    ).resolves.toEqual({ kind: "invalid_invitation" });

    const expiredRecording = createRecordingEmailProvider();
    const issuedAt = new Date("2026-08-01T00:00:00.000Z");
    const expiredIssuer = service(expiredRecording, () => issuedAt).value;
    await expiredIssuer.createInvitation({
      actorUserId: ownerUser.id,
      invitation: {
        branchIds: [],
        email: "expired-invitee@example.com",
        role: "ADMIN",
      },
      organizationId: store.id,
    });
    const expiredToken = invitationToken(expiredRecording);
    await expect(
      service(
        expiredRecording,
        () => new Date("2026-08-09T00:00:00.000Z"),
      ).value.acceptInvitation({
        actorEmail: "expired-invitee@example.com",
        actorUserId: invitedUser.id,
        rawToken: expiredToken,
      }),
    ).resolves.toEqual({ kind: "invalid_invitation" });
  });

  it("fully replaces scope, enforces optimistic state and delegation, and removes/reactivates effective access", async () => {
    const store = await organization();
    const first = await branch(store.id, "A");
    const second = await branch(store.id, "B");
    const ownerUser = await user("owner@example.com");
    const adminUser = await user("admin@example.com");
    const cashierUser = await user("cashier@example.com");
    const ownerMembership = await membership(store.id, ownerUser, "OWNER");
    await membership(store.id, adminUser, "ADMIN");
    const cashierMembership = await membership(
      store.id,
      cashierUser,
      "CASHIER",
    );
    await prisma.session.create({
      data: {
        absoluteExpiresAt: new Date(NOW.getTime() + 86_400_000),
        idleExpiresAt: new Date(NOW.getTime() + 3_600_000),
        issuedAt: NOW,
        lastUsedAt: NOW,
        tokenHash: "cashier-session-hash",
        userId: cashierUser.id,
      },
    });
    await prisma.branchAssignment.create({
      data: {
        branchId: first.id,
        organizationId: store.id,
        userId: cashierUser.id,
      },
    });
    const access = service().value;

    await expect(
      access.replaceMembership({
        actorUserId: adminUser.id,
        membershipId: ownerMembership.id,
        organizationId: store.id,
        replacement: {
          branchIds: [],
          expectedUpdatedAt: ownerMembership.updatedAt,
          role: "ADMIN",
        },
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    const replaced = await access.replaceMembership({
      actorUserId: ownerUser.id,
      membershipId: cashierMembership.id,
      organizationId: store.id,
      replacement: {
        branchIds: [second.id],
        expectedUpdatedAt: cashierMembership.updatedAt,
        role: "BRANCH_MANAGER",
      },
    });
    expect(replaced).toMatchObject({
      kind: "success",
      membership: { role: "BRANCH_MANAGER" },
    });
    if (replaced.kind !== "success") throw new Error("Expected replacement.");
    expect(replaced.membership.branchAssignments).toMatchObject([
      { branch: { id: first.id }, status: "INACTIVE" },
      { branch: { id: second.id }, status: "ACTIVE" },
    ]);
    await expect(
      access.replaceMembership({
        actorUserId: ownerUser.id,
        membershipId: cashierMembership.id,
        organizationId: store.id,
        replacement: {
          branchIds: [first.id],
          expectedUpdatedAt: cashierMembership.updatedAt,
          role: "CASHIER",
        },
      }),
    ).resolves.toEqual({ kind: "stale" });

    const deactivated = await access.deactivateMembership({
      actorUserId: ownerUser.id,
      expectedUpdatedAt: new Date(replaced.membership.updatedAt),
      membershipId: cashierMembership.id,
      organizationId: store.id,
    });
    expect(deactivated).toMatchObject({
      kind: "success",
      membership: { status: "INACTIVE" },
    });
    expect(
      (await createPrismaBranchRepository(prisma).accessContext(cashierUser.id))
        ?.organizations,
    ).toEqual([]);
    expect(
      await prisma.session.findFirstOrThrow({
        where: { userId: cashierUser.id },
      }),
    ).toMatchObject({ revokedAt: null });
    if (deactivated.kind !== "success")
      throw new Error("Expected deactivation.");
    const reactivated = await access.reactivateMembership({
      actorUserId: ownerUser.id,
      membershipId: cashierMembership.id,
      organizationId: store.id,
      replacement: {
        branchIds: [first.id],
        expectedUpdatedAt: new Date(deactivated.membership.updatedAt),
        role: "CASHIER",
      },
    });
    expect(reactivated).toMatchObject({
      kind: "success",
      membership: { role: "CASHIER", status: "ACTIVE" },
    });
  });

  it("serializes concurrent full replacements with an exact optimistic version", async () => {
    const store = await organization();
    const first = await branch(store.id, "A");
    const second = await branch(store.id, "B");
    const ownerUser = await user("owner@example.com");
    const cashierUser = await user("cashier@example.com");
    await membership(store.id, ownerUser, "OWNER");
    const target = await membership(store.id, cashierUser, "CASHIER");
    await prisma.branchAssignment.create({
      data: {
        branchId: first.id,
        organizationId: store.id,
        userId: cashierUser.id,
      },
    });
    const access = service().value;
    const outcomes = await Promise.all([
      access.replaceMembership({
        actorUserId: ownerUser.id,
        membershipId: target.id,
        organizationId: store.id,
        replacement: {
          branchIds: [second.id],
          expectedUpdatedAt: target.updatedAt,
          role: "CASHIER",
        },
      }),
      access.replaceMembership({
        actorUserId: ownerUser.id,
        membershipId: target.id,
        organizationId: store.id,
        replacement: {
          branchIds: [],
          expectedUpdatedAt: target.updatedAt,
          role: "ADMIN",
        },
      }),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "stale",
      "success",
    ]);
    expect(await prisma.membershipAccessEvent.count()).toBe(1);
  });

  it("serializes concurrent owner reductions and paginates management views without token data", async () => {
    const store = await organization();
    const firstOwner = await user("owner-one@example.com");
    const secondOwner = await user("owner-two@example.com");
    const firstMembership = await membership(store.id, firstOwner, "OWNER");
    const secondMembership = await membership(store.id, secondOwner, "OWNER");
    const access = service().value;
    const outcomes = await Promise.all([
      access.deactivateMembership({
        actorUserId: firstOwner.id,
        expectedUpdatedAt: firstMembership.updatedAt,
        membershipId: firstMembership.id,
        organizationId: store.id,
      }),
      access.deactivateMembership({
        actorUserId: secondOwner.id,
        expectedUpdatedAt: secondMembership.updatedAt,
        membershipId: secondMembership.id,
        organizationId: store.id,
      }),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "last_active_owner",
      "success",
    ]);
    expect(
      await prisma.organizationMembership.count({
        where: { organizationId: store.id, role: "OWNER", status: "ACTIVE" },
      }),
    ).toBe(1);
    const activeOwner = await prisma.organizationMembership.findFirstOrThrow({
      where: { organizationId: store.id, role: "OWNER", status: "ACTIVE" },
    });
    const page = await access.listMemberships({
      actorUserId: activeOwner.userId,
      includeInactive: true,
      limit: 1,
      organizationId: store.id,
    });
    expect(page).toMatchObject({
      kind: "success",
      page: { items: [expect.any(Object)], nextCursor: expect.any(String) },
    });
    if (page.kind !== "success" || page.page.nextCursor === null)
      throw new Error("Expected cursor.");
    await expect(
      access.listMemberships({
        actorUserId: activeOwner.userId,
        cursor: page.page.nextCursor,
        includeInactive: true,
        limit: 1,
        organizationId: store.id,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      page: { items: [expect.any(Object)] },
    });
  });
});
