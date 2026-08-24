import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { FirstOrganizationOnboardingInput } from "./first-organization-onboarding-schema.ts";

export interface FirstOrganizationOnboardingResult {
  branch: {
    address: string | null;
    code: "MAIN";
    id: string;
    name: string;
    phone: string | null;
  };
  nextStep: "app";
  organization: {
    id: string;
    name: string;
  };
  role: "OWNER";
  user: {
    displayName: string;
    id: string;
    phone: string | null;
  };
}

export type FirstOrganizationOnboardingOutcome =
  | {
      kind: "success";
      replayed: boolean;
      result: FirstOrganizationOnboardingResult;
    }
  | { kind: "already_onboarded" }
  | { kind: "already_has_organization_access" };

export interface FirstOrganizationOnboardingRepository {
  complete(input: {
    actorUserId: string;
    onboarding: FirstOrganizationOnboardingInput;
    requestHash: string;
  }): Promise<FirstOrganizationOnboardingOutcome>;
}

export type FirstOrganizationOnboardingTransactionStage =
  | "profile_updated"
  | "organization_created"
  | "owner_membership_created"
  | "branch_created"
  | "provenance_created";

type OnboardingPrismaClient = Pick<PrismaClient, "$transaction">;

const onboardingResultSelection = {
  requestHash: true,
  membership: {
    select: {
      user: {
        select: {
          displayName: true,
          id: true,
          phone: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  branch: {
    select: {
      address: true,
      code: true,
      id: true,
      name: true,
      phone: true,
    },
  },
} as const;

function publicResult(record: {
  branch: {
    address: string | null;
    code: string;
    id: string;
    name: string;
    phone: string | null;
  };
  organization: { id: string; name: string };
  user: { displayName: string | null; id: string; phone: string | null };
}): FirstOrganizationOnboardingResult {
  if (record.user.displayName === null || record.branch.code !== "MAIN") {
    throw new Error("Persisted first onboarding state is invalid.");
  }

  return {
    branch: {
      address: record.branch.address,
      code: "MAIN",
      id: record.branch.id,
      name: record.branch.name,
      phone: record.branch.phone,
    },
    nextStep: "app",
    organization: record.organization,
    role: "OWNER",
    user: {
      displayName: record.user.displayName,
      id: record.user.id,
      phone: record.user.phone,
    },
  };
}

export function createPrismaFirstOrganizationOnboardingRepository(
  prisma: OnboardingPrismaClient,
  options: {
    afterStage?: (
      stage: FirstOrganizationOnboardingTransactionStage,
    ) => Promise<void> | void;
  } = {},
): FirstOrganizationOnboardingRepository {
  const afterStage = options.afterStage ?? (() => undefined);

  return {
    async complete({ actorUserId, onboarding, requestHash }) {
      return prisma.$transaction(async (transaction) => {
        const lockedUsers = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`
            SELECT "id"
            FROM "users"
            WHERE "id" = ${actorUserId}::uuid
            FOR UPDATE
          `,
        );
        if (lockedUsers.length !== 1) {
          throw new Error("Authenticated onboarding actor no longer exists.");
        }

        const existing =
          await transaction.firstOrganizationOnboarding.findUnique({
            where: { userId: actorUserId },
            select: onboardingResultSelection,
          });
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            return { kind: "already_onboarded" };
          }

          return {
            kind: "success",
            replayed: true,
            result: publicResult({
              branch: existing.branch,
              organization: existing.membership.organization,
              user: existing.membership.user,
            }),
          };
        }

        const membershipCount = await transaction.organizationMembership.count({
          where: { userId: actorUserId },
        });
        if (membershipCount !== 0) {
          return { kind: "already_has_organization_access" };
        }

        const user = await transaction.user.update({
          where: { id: actorUserId },
          data: {
            displayName: onboarding.displayName,
            phone: onboarding.phone,
          },
          select: { displayName: true, id: true, phone: true },
        });
        await afterStage("profile_updated");

        const organization = await transaction.organization.create({
          data: { name: onboarding.organizationName },
          select: { id: true, name: true },
        });
        await afterStage("organization_created");

        await transaction.organizationMembership.create({
          data: {
            organizationId: organization.id,
            role: "OWNER",
            userId: actorUserId,
          },
          select: { organizationId: true, userId: true },
        });
        await afterStage("owner_membership_created");

        const branch = await transaction.branch.create({
          data: {
            address: onboarding.branchAddress,
            code: "MAIN",
            name: onboarding.branchName,
            organizationId: organization.id,
            phone: onboarding.branchPhone,
          },
          select: {
            address: true,
            code: true,
            id: true,
            name: true,
            phone: true,
          },
        });
        await afterStage("branch_created");

        await transaction.firstOrganizationOnboarding.create({
          data: {
            branchId: branch.id,
            organizationId: organization.id,
            requestHash,
            userId: actorUserId,
          },
          select: { userId: true },
        });
        await afterStage("provenance_created");

        return {
          kind: "success",
          replayed: false,
          result: publicResult({ branch, organization, user }),
        };
      });
    },
  };
}
