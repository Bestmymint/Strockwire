import type {
  AiInsightState,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { isBranchActiveAt } from "../organizations/branch-status-history.ts";
import type { AiInsightJobInput } from "./ai-insight-job.ts";
import { dueAiInsightPeriods } from "./ai-insight-cadence.ts";

type DiscoveryClient = Pick<
  PrismaClient,
  "organization" | "branch" | "branchStatusEvent"
>;

export function createAiInsightOrchestrator(
  prisma: DiscoveryClient,
  runJob: (input: AiInsightJobInput) => Promise<{ state: AiInsightState }>,
) {
  return async function run(now: Date) {
    const result = {
      scannedOrganizations: 0,
      candidateJobs: 0,
      succeeded: 0,
      failed: 0,
      executionErrors: 0,
      insufficient: 0,
      inProgress: 0,
      skippedBranchInactive: 0,
      skippedBranchHistoryUnavailable: 0,
    };
    const organizations = await prisma.organization.findMany({
      where: { status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: { id: true, reportingTimezone: true },
    });

    for (const organization of organizations) {
      result.scannedOrganizations++;
      const periods = dueAiInsightPeriods(now, organization.reportingTimezone);
      const oldestDue = new Date(
        Math.min(...periods.map((period) => period.dueInstant.getTime())),
      );
      const branches = await prisma.branch.findMany({
        where: {
          organizationId: organization.id,
          OR: [
            { status: "ACTIVE" },
            { statusEvents: { some: { effectiveAt: { gte: oldestDue } } } },
          ],
        },
        orderBy: { id: "asc" },
        select: { id: true },
      });

      for (const period of periods) {
        const input = {
          organizationId: organization.id,
          from: period.from,
          to: period.to,
          granularity: period.granularity,
          reportingTimezone: period.reportingTimezone,
          periodStartInclusive: period.periodStartInclusive,
          periodEndExclusive: period.periodEndExclusive,
        };
        async function execute(scope: AiInsightJobInput["scope"]) {
          result.candidateJobs++;
          try {
            const report = await runJob({ ...input, scope });
            switch (report.state) {
              case "SUCCEEDED":
                result.succeeded++;
                break;
              case "FAILED":
                result.failed++;
                break;
              case "INSUFFICIENT":
                result.insufficient++;
                break;
              case "IN_PROGRESS":
                result.inProgress++;
                break;
            }
          } catch {
            result.executionErrors++;
          }
        }

        await execute({ kind: "organization" });
        for (const branch of branches) {
          const active = await isBranchActiveAt(
            prisma,
            organization.id,
            branch.id,
            period.dueInstant,
          );
          if (active === null) {
            result.skippedBranchHistoryUnavailable++;
          } else if (!active) {
            result.skippedBranchInactive++;
          } else {
            await execute({ kind: "branch", branchId: branch.id });
          }
        }
      }
    }
    return result;
  };
}
