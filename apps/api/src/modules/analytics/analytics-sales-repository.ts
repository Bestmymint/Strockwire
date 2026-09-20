import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { AnalyticsExecutionContext } from "./analytics-context.ts";
import { createAnalyticsComparisonBucket } from "./analytics-period.ts";
import {
  buildAnalyticsSalesMetricBuckets,
  type AnalyticsSalesAggregateRow,
  type AnalyticsSalesMetricBucket,
} from "./analytics-sales-values.ts";

export interface AnalyticsSalesMetrics {
  buckets: readonly AnalyticsSalesMetricBucket[];
  context: AnalyticsExecutionContext;
  metricDefinitionVersion: "analytics-v1";
}

export interface AnalyticsSalesRepository {
  read(context: AnalyticsExecutionContext): Promise<AnalyticsSalesMetrics>;
}

type AnalyticsSalesPrismaClient = Pick<PrismaClient, "$queryRaw">;

function bucketSql(input: {
  bucketEndExclusive: Date;
  bucketIndex: number;
  bucketStartInclusive: Date;
}): Prisma.Sql {
  return Prisma.sql`(
    ${input.bucketIndex}::integer,
    ${input.bucketStartInclusive}::timestamptz,
    ${input.bucketEndExclusive}::timestamptz
  )`;
}

export function createPrismaAnalyticsSalesRepository(
  prisma: AnalyticsSalesPrismaClient,
): AnalyticsSalesRepository {
  return {
    async read(context) {
      const comparisonBucket = createAnalyticsComparisonBucket(context.period);
      const bucketBounds = [
        bucketSql({
          bucketEndExclusive: comparisonBucket.bucketEndExclusive,
          bucketIndex: -1,
          bucketStartInclusive: comparisonBucket.bucketStartInclusive,
        }),
        ...context.period.buckets.map((bucket, bucketIndex) =>
          bucketSql({
            bucketEndExclusive: bucket.bucketEndExclusive,
            bucketIndex,
            bucketStartInclusive: bucket.bucketStartInclusive,
          }),
        ),
      ];
      const branchIds = context.scope.branchIds.map(
        (branchId) => Prisma.sql`${branchId}::uuid`,
      );

      // Both operational sources are aggregated by one PostgreSQL statement. Under
      // PostgreSQL MVCC, every CTE in this statement observes the same read snapshot.
      const rows = await prisma.$queryRaw<
        AnalyticsSalesAggregateRow[]
      >(Prisma.sql`
        WITH bucket_bounds (bucket_index, start_inclusive, end_exclusive) AS (
          VALUES ${Prisma.join(bucketBounds)}
        ),
        sale_metrics AS (
          SELECT
            buckets.bucket_index,
            COALESCE(SUM(items.line_gross), 0)::numeric AS "grossSalesAmount",
            COALESCE(SUM(items.line_discount), 0)::numeric AS "discountAmount",
            COALESCE(SUM(items.line_net), 0)::numeric AS "salesAfterDiscountAmount",
            COALESCE(SUM(items.line_output_vat), 0)::numeric AS "outputVatAmount",
            SUM(items.line_taxable)::numeric AS "registeredTaxableSalesAmount",
            COUNT(DISTINCT sales.id)::bigint AS "saleCount",
            COALESCE(SUM(items.cogs_amount), 0)::numeric AS "saleCogsAmount",
            COUNT(items.id) FILTER (
              WHERE items.cogs_amount IS NOT NULL
            )::bigint AS "knownSaleCostLineCount",
            COUNT(items.id) FILTER (
              WHERE items.cogs_amount IS NULL
            )::bigint AS "unknownSaleCostLineCount"
          FROM bucket_bounds AS buckets
          LEFT JOIN sales
            ON sales.organization_id = ${context.scope.organizationId}::uuid
            AND sales.branch_id IN (${Prisma.join(branchIds)})
            AND sales.completed_at >= buckets.start_inclusive
            AND sales.completed_at < buckets.end_exclusive
            AND sales.completed_at <= ${context.period.sourceCutoff}::timestamptz
          LEFT JOIN sale_items AS items
            ON items.sale_id = sales.id
            AND items.organization_id = sales.organization_id
            AND items.branch_id = sales.branch_id
          GROUP BY buckets.bucket_index
        ),
        refund_metrics AS (
          SELECT
            buckets.bucket_index,
            COALESCE(SUM(items.reversed_line_net), 0)::numeric AS "refundAmount",
            COALESCE(SUM(items.reversed_line_discount), 0)::numeric AS "refundedDiscountAmount",
            COALESCE(SUM(items.reversed_line_output_vat), 0)::numeric AS "refundedOutputVatAmount",
            SUM(items.reversed_line_taxable)::numeric AS "refundedRegisteredTaxableAmount",
            COUNT(DISTINCT refunds.id)::bigint AS "refundCount",
            COUNT(DISTINCT refunds.sale_id)::bigint AS "refundedSaleCount",
            COALESCE(
              SUM(items.cogs_reversal_amount) FILTER (
                WHERE items.restock_quantity > 0
                  AND items.cogs_reversal_amount IS NOT NULL
              ),
              0
            )::numeric AS "refundCogsReversalAmount",
            COUNT(items.id) FILTER (
              WHERE items.restock_quantity > 0
                AND items.cogs_reversal_amount IS NOT NULL
            )::bigint AS "knownRefundCostLineCount",
            COUNT(items.id) FILTER (
              WHERE items.restock_quantity > 0
                AND items.cogs_reversal_amount IS NULL
            )::bigint AS "unknownRefundCostLineCount"
          FROM bucket_bounds AS buckets
          LEFT JOIN sale_refunds AS refunds
            ON refunds.organization_id = ${context.scope.organizationId}::uuid
            AND refunds.branch_id IN (${Prisma.join(branchIds)})
            AND refunds.completed_at >= buckets.start_inclusive
            AND refunds.completed_at < buckets.end_exclusive
            AND refunds.completed_at <= ${context.period.sourceCutoff}::timestamptz
          LEFT JOIN sale_refund_items AS items
            ON items.sale_refund_id = refunds.id
            AND items.organization_id = refunds.organization_id
            AND items.branch_id = refunds.branch_id
            AND items.sale_id = refunds.sale_id
          GROUP BY buckets.bucket_index
        )
        SELECT
          sales.bucket_index AS "bucketIndex",
          sales."grossSalesAmount",
          sales."discountAmount",
          sales."salesAfterDiscountAmount",
          sales."outputVatAmount",
          sales."registeredTaxableSalesAmount",
          sales."saleCount",
          sales."saleCogsAmount",
          sales."knownSaleCostLineCount",
          sales."unknownSaleCostLineCount",
          refunds."refundAmount",
          refunds."refundedDiscountAmount",
          refunds."refundedOutputVatAmount",
          refunds."refundedRegisteredTaxableAmount",
          refunds."refundCount",
          refunds."refundedSaleCount",
          refunds."refundCogsReversalAmount",
          refunds."knownRefundCostLineCount",
          refunds."unknownRefundCostLineCount"
        FROM sale_metrics AS sales
        INNER JOIN refund_metrics AS refunds
          ON refunds.bucket_index = sales.bucket_index
        ORDER BY sales.bucket_index ASC
      `);

      return Object.freeze({
        buckets: buildAnalyticsSalesMetricBuckets({
          buckets: context.period.buckets,
          canViewCost: context.scope.canViewCost,
          comparisonBucket,
          rows,
        }),
        context,
        metricDefinitionVersion: context.period.metricDefinitionVersion,
      });
    },
  };
}
