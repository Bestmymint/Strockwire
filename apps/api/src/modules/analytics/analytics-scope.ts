import {
  can,
  createTrustedBranchScope,
  PERMISSIONS,
  type Permission,
  type TrustedAuthorizationContext,
} from "../identity/authorization-policy.ts";

export const ANALYTICS_KINDS = ["business", "inventory"] as const;
export type AnalyticsKind = (typeof ANALYTICS_KINDS)[number];

export type AnalyticsScopeCandidate =
  | Readonly<{ kind: "organization" }>
  | Readonly<{ branchId: string; kind: "branch" }>;

export interface AnalyticsBranchRecord {
  id: string;
  organizationId: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface AuthorizedAnalyticsScope {
  branchCount: number;
  branchIds: readonly string[];
  canViewCost: boolean;
  kind: AnalyticsScopeCandidate["kind"];
  organizationId: string;
}

export type AnalyticsScopeResolution =
  | Readonly<{ kind: "allowed"; scope: AuthorizedAnalyticsScope }>
  | Readonly<{ kind: "forbidden" }>;

function analyticsPermission(kind: AnalyticsKind): Permission {
  return kind === "business"
    ? PERMISSIONS.BUSINESS_ANALYTICS_VIEW
    : PERMISSIONS.INVENTORY_ANALYTICS_VIEW;
}

function isOrganizationWideRole(context: TrustedAuthorizationContext): boolean {
  return context.role === "OWNER" || context.role === "ADMIN";
}

function allowedForPermission(input: {
  branch: AnalyticsBranchRecord;
  context: TrustedAuthorizationContext;
  permission: Permission;
}): boolean {
  const scope = createTrustedBranchScope({
    branchId: input.branch.id,
    branchOrganizationId: input.branch.organizationId,
    organizationId: input.context.organizationId,
  });

  return can(input.context, input.permission, scope);
}

export function resolveAnalyticsBranchSet(input: {
  analyticsKind: AnalyticsKind;
  branches: readonly AnalyticsBranchRecord[];
  candidate: AnalyticsScopeCandidate;
  context: TrustedAuthorizationContext;
}): AnalyticsScopeResolution {
  const organizationWide = isOrganizationWideRole(input.context);
  const candidate = input.candidate;
  const requestedBranches =
    candidate.kind === "branch"
      ? input.branches.filter((branch) => branch.id === candidate.branchId)
      : input.branches;

  const branchIds = requestedBranches
    .filter(
      (branch) =>
        branch.organizationId === input.context.organizationId &&
        (organizationWide || branch.status === "ACTIVE") &&
        allowedForPermission({
          branch,
          context: input.context,
          permission: analyticsPermission(input.analyticsKind),
        }),
    )
    .map((branch) => branch.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  if (branchIds.length === 0) {
    return Object.freeze({ kind: "forbidden" as const });
  }

  const allowedBranches = requestedBranches.filter((branch) =>
    branchIds.includes(branch.id),
  );
  const canViewCost = allowedBranches.every((branch) =>
    allowedForPermission({
      branch,
      context: input.context,
      permission: PERMISSIONS.SALES_COST_VIEW,
    }),
  );

  return Object.freeze({
    kind: "allowed" as const,
    scope: Object.freeze({
      branchCount: branchIds.length,
      branchIds: Object.freeze(branchIds),
      canViewCost,
      kind: candidate.kind,
      organizationId: input.context.organizationId,
    }),
  });
}
