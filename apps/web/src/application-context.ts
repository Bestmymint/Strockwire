import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessContext,
  AccessibleOrganization,
} from "./branch-api-client";

export interface ResolvedApplicationContext {
  branch: AccessibleOrganization["branches"][number] | null;
  organization: AccessibleOrganization | null;
}

export function resolveApplicationContext(
  context: AccessContext,
  requestedOrganizationId: string | null,
  requestedBranchId: string | null,
): ResolvedApplicationContext {
  const requestedOrganization = context.organizations.find(
    ({ id }) => id === requestedOrganizationId,
  );
  const organization =
    requestedOrganization ??
    (context.organizations.length === 1 ? context.organizations[0] : null) ??
    null;
  const requestedBranch = organization?.branches.find(
    ({ id }) => id === requestedBranchId,
  );
  return {
    branch: requestedBranch ?? organization?.branches[0] ?? null,
    organization,
  };
}

export function applicationContextUrl(
  organizationId: string,
  branchId: string | null,
): string {
  const params = new URLSearchParams({ organizationId });
  if (branchId !== null) params.set("branchId", branchId);
  return `/app?${params.toString()}`;
}

export async function clearPreviousBranchQueries(
  queryClient: QueryClient,
  organizationId: string | null,
  branchId: string | null,
): Promise<void> {
  if (organizationId === null || branchId === null) return;
  const queryKey = ["branch-scoped", organizationId, branchId] as const;
  await queryClient.cancelQueries({ queryKey });
  queryClient.removeQueries({ queryKey });
}
