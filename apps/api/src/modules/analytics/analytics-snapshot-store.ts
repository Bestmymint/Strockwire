import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import { z } from "zod";

export const ANALYTICS_SNAPSHOT_SCHEMA_VERSION = "analytics-snapshot-v1";
export const ANALYTICS_SNAPSHOT_METRIC_VERSION = "analytics-v1";

const money = z.string().regex(/^-?\d+\.\d{2}$/);
const cost = z.string().regex(/^-?\d+\.\d{10}$/);
const nullable = (value: z.ZodString) =>
  z
    .object({
      reason: z
        .enum([
          "INCOMPLETE_COST_COVERAGE",
          "NO_BASELINE",
          "NON_COMPARABLE_PERIOD",
          "NON_POSITIVE_NET_SALES",
          "NO_SALES",
          "NO_REGISTERED_REFUNDS",
          "NO_REGISTERED_SALES",
        ])
        .nullable(),
      value: value.nullable(),
    })
    .strict()
    .refine((metric) => (metric.value === null) !== (metric.reason === null));

export const analyticsSnapshotPayloadSchema = z
  .object({
    sales: z
      .object({
        averageOrderValue: nullable(money),
        costCoverage: z.enum(["complete", "partial", "none"]),
        grossMarginPercent: nullable(money),
        grossProfitAmount: nullable(cost),
        netSalesAmount: money,
        netSalesGrowthPercent: nullable(money),
        refundAmount: money,
        refundCount: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        saleCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  })
  .strict();

export type AnalyticsSnapshotPayload = z.infer<
  typeof analyticsSnapshotPayloadSchema
>;

export class AnalyticsSnapshotConflictError extends Error {
  constructor() {
    super("An immutable analytics snapshot already has different content.");
  }
}

type SnapshotRow = NonNullable<
  Awaited<ReturnType<PrismaClient["analyticsSnapshot"]["findFirst"]>>
>;

function validated(row: SnapshotRow) {
  if (
    row.schemaVersion !== ANALYTICS_SNAPSHOT_SCHEMA_VERSION ||
    row.metricDefinitionVersion !== ANALYTICS_SNAPSHOT_METRIC_VERSION
  ) {
    throw new Error("Unsupported analytics snapshot version.");
  }
  return { ...row, payload: analyticsSnapshotPayloadSchema.parse(row.payload) };
}

type SnapshotInput = Omit<
  Prisma.AnalyticsSnapshotUncheckedCreateInput,
  "id" | "createdAt" | "payload"
> & { payload: AnalyticsSnapshotPayload };

function identity(input: SnapshotIdentity) {
  return {
    organizationId: input.organizationId,
    scopeKey: input.scopeKey,
    cadence: input.cadence,
    reportingTimezone: input.reportingTimezone,
    periodStartInclusive: input.periodStartInclusive,
    periodEndExclusive: input.periodEndExclusive,
    schemaVersion: input.schemaVersion,
    metricDefinitionVersion: input.metricDefinitionVersion,
  };
}

type SnapshotIdentity = Pick<
  SnapshotInput,
  | "organizationId"
  | "scopeKey"
  | "cadence"
  | "reportingTimezone"
  | "periodStartInclusive"
  | "periodEndExclusive"
  | "schemaVersion"
  | "metricDefinitionVersion"
>;

export function createPrismaAnalyticsSnapshotStore(prisma: PrismaClient) {
  async function findByIdentity(input: SnapshotIdentity) {
    const row = await prisma.analyticsSnapshot.findUnique({
      where: {
        organizationId_scopeKey_cadence_reportingTimezone_periodStartInclusive_periodEndExclusive_schemaVersion_metricDefinitionVersion:
          identity(input),
      },
    });
    return row === null ? null : validated(row);
  }

  return {
    async findById(organizationId: string, id: string) {
      const row = await prisma.analyticsSnapshot.findFirst({
        where: { id, organizationId },
      });
      return row === null ? null : validated(row);
    },
    findByIdentity,
    async createOrRead(input: SnapshotInput) {
      const payload = analyticsSnapshotPayloadSchema.parse(input.payload);
      try {
        return validated(
          await prisma.analyticsSnapshot.create({
            data: { ...input, payload: payload as Prisma.InputJsonValue },
          }),
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
      }

      const existing = await findByIdentity(input);
      if (
        existing !== null &&
        existing.dataStatus === input.dataStatus &&
        existing.localFromInclusive === input.localFromInclusive &&
        existing.localToExclusive === input.localToExclusive &&
        JSON.stringify(existing.payload) === JSON.stringify(payload)
      ) {
        return existing;
      }
      throw new AnalyticsSnapshotConflictError();
    },
  };
}
