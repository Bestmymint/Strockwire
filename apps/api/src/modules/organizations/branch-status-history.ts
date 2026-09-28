import type { PrismaClient } from "../../generated/prisma/client.ts";

// null means the Branch/tenant is unknown or the instant predates trustworthy history.
export async function isBranchActiveAt(
  prisma: Pick<PrismaClient, "branchStatusEvent">,
  organizationId: string,
  branchId: string,
  instant: Date,
): Promise<boolean | null> {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Branch status instant must be valid.");
  }
  const event = await prisma.branchStatusEvent.findFirst({
    where: { organizationId, branchId, effectiveAt: { lte: instant } },
    orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    select: { status: true },
  });
  return event === null ? null : event.status === "ACTIVE";
}
