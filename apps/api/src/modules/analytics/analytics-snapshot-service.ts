import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { AnalyticsExecutionContext } from "./analytics-context.ts";
import {
  createAnalyticsPeriodContext,
  type AnalyticsGranularity,
} from "./analytics-period.ts";
import { createPrismaAnalyticsSalesRepository } from "./analytics-sales-repository.ts";
import type { AnalyticsScopeCandidate } from "./analytics-scope.ts";
import {
  ANALYTICS_SNAPSHOT_METRIC_VERSION,
  ANALYTICS_SNAPSHOT_SCHEMA_VERSION,
  createPrismaAnalyticsSnapshotStore,
  type AnalyticsSnapshotPayload,
} from "./analytics-snapshot-store.ts";

const cadence = {
  day: "DAILY",
  week: "WEEKLY",
  month: "MONTHLY",
  year: "YEARLY",
} as const;

export function createAnalyticsSnapshotService(prisma: PrismaClient) {
  const store = createPrismaAnalyticsSnapshotStore(prisma);
  return {
    findById: store.findById,
    findByIdentity: store.findByIdentity,
    async create(input: {
      organizationId: string;
      scope: AnalyticsScopeCandidate;
      from: string;
      to: string;
      granularity: AnalyticsGranularity;
    }) {
      const candidate = await prisma.$transaction(
        async (tx) => {
          // The first statement pins one MVCC read snapshot and one event cutoff.
          const captured = await tx.$queryRaw<{ capturedAt: Date }[]>(
            Prisma.sql`SELECT clock_timestamp() AS "capturedAt"`,
          );
          const capturedAt = captured[0]?.capturedAt;
          if (capturedAt === undefined)
            throw new Error("Missing snapshot cutoff.");
          const organization = await tx.organization.findUnique({
            where: { id: input.organizationId },
            select: {
              branches: {
                orderBy: { id: "asc" },
                select: { id: true },
              },
              reportingTimezone: true,
              status: true,
            },
          });
          if (organization?.status !== "ACTIVE") {
            throw new Error("Analytics snapshot organization is unavailable.");
          }
          const scope = input.scope;
          const branches =
            scope.kind === "organization"
              ? organization.branches
              : organization.branches.filter(
                  (branch) => branch.id === scope.branchId,
                );
          if (branches.length === 0) {
            throw new Error("Analytics snapshot scope is unavailable.");
          }
          const period = createAnalyticsPeriodContext({
            from: input.from,
            to: input.to,
            granularity: input.granularity,
            reportingTimezone: organization.reportingTimezone,
            sourceCutoff: capturedAt,
          });
          if (period.buckets.length !== 1 || period.dataStatus !== "complete") {
            throw new Error(
              "Analytics snapshot requires one completed period.",
            );
          }
          const context: AnalyticsExecutionContext = {
            period,
            scope: {
              branchCount: branches.length,
              branchIds: branches.map((branch) => branch.id),
              canViewCost: true,
              kind: input.scope.kind,
              organizationId: input.organizationId,
            },
          };
          const sales = (
            await createPrismaAnalyticsSalesRepository(tx).read(context)
          ).buckets[0];
          if (sales?.cost === undefined) {
            throw new Error("Cost-authorized analytics aggregate is missing.");
          }
          const payload: AnalyticsSnapshotPayload = {
            sales: {
              averageOrderValue: sales.averageOrderValue,
              costCoverage: sales.cost.costCoverage,
              grossMarginPercent: sales.cost.grossMarginPercent,
              grossProfitAmount: sales.cost.grossProfitAmount,
              netSalesAmount: sales.netSalesAmount,
              netSalesGrowthPercent: sales.netSalesGrowthPercent,
              refundAmount: sales.refundAmount,
              refundCount: sales.refundCount,
              saleCount: sales.saleCount,
            },
          };
          return {
            organizationId: input.organizationId,
            branchId:
              input.scope.kind === "branch" ? input.scope.branchId : null,
            scope: input.scope.kind === "branch" ? "BRANCH" : "ORGANIZATION",
            scopeKey:
              input.scope.kind === "branch"
                ? input.scope.branchId
                : "organization",
            cadence: cadence[input.granularity],
            reportingTimezone: period.reportingTimezone,
            localFromInclusive: period.from,
            localToExclusive: period.to,
            periodStartInclusive: period.periodStartInclusive,
            periodEndExclusive: period.periodEndExclusive,
            schemaVersion: ANALYTICS_SNAPSHOT_SCHEMA_VERSION,
            metricDefinitionVersion: ANALYTICS_SNAPSHOT_METRIC_VERSION,
            sourceCutoff: period.sourceCutoff,
            dataStatus: "complete",
            payload,
          } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return store.createOrRead(candidate);
    },
  };
}
