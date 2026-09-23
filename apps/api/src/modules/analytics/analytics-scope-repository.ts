import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  createTrustedAuthorizationContext,
  type ResolvedAuthorizationState,
} from "../identity/authorization-policy.ts";
import {
  resolveAnalyticsBranchSet,
  type AnalyticsKind,
  type AnalyticsScopeCandidate,
  type AuthorizedAnalyticsScope,
} from "./analytics-scope.ts";
import { validateIanaTimeZone } from "./analytics-period.ts";

export type AnalyticsScopeRepositoryOutcome =
  | Readonly<{
      kind: "success";
      reportingTimezone: string;
      scope: AuthorizedAnalyticsScope;
    }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "invalid_reporting_timezone" }>;

export interface AnalyticsScopeRepository {
  resolve(input: {
    actorUserId: string;
    analyticsKind: AnalyticsKind;
    candidate: AnalyticsScopeCandidate;
    organizationId: string;
  }): Promise<AnalyticsScopeRepositoryOutcome>;
}

type AnalyticsScopePrismaClient = Pick<PrismaClient, "organizationMembership">;

export function createPrismaAnalyticsScopeRepository(
  prisma: AnalyticsScopePrismaClient,
): AnalyticsScopeRepository {
  return {
    async resolve(input) {
      const membership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.actorUserId,
          },
        },
        select: {
          branchAssignments: {
            select: {
              branchId: true,
              organizationId: true,
              status: true,
              userId: true,
            },
          },
          organization: {
            select: {
              branches: {
                orderBy: { id: "asc" },
                select: { id: true, organizationId: true, status: true },
              },
              reportingTimezone: true,
              status: true,
            },
          },
          organizationId: true,
          role: true,
          status: true,
          user: { select: { id: true, status: true } },
          userId: true,
        },
      });

      if (membership === null || membership.organization.status !== "ACTIVE") {
        return { kind: "forbidden" };
      }

      const state: ResolvedAuthorizationState = {
        actor: membership.user,
        branchAssignments: membership.branchAssignments,
        membership: {
          organizationId: membership.organizationId,
          role: membership.role,
          status: membership.status,
          userId: membership.userId,
        },
      };
      const context = createTrustedAuthorizationContext(state);
      if (context === null) {
        return { kind: "forbidden" };
      }

      const resolution = resolveAnalyticsBranchSet({
        analyticsKind: input.analyticsKind,
        branches: membership.organization.branches,
        candidate: input.candidate,
        context,
      });

      if (resolution.kind !== "allowed") return resolution;

      let reportingTimezone: string;
      try {
        reportingTimezone = validateIanaTimeZone(
          membership.organization.reportingTimezone,
        );
      } catch {
        return { kind: "invalid_reporting_timezone" };
      }

      return { kind: "success", reportingTimezone, scope: resolution.scope };
    },
  };
}
