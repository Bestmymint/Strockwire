import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { AnalyticsExecutionContext } from "./analytics-context.ts";
import type { AnalyticsDimensionCursorCodec } from "./analytics-dimension-cursor.ts";
import { createAnalyticsComparisonBucket } from "./analytics-period.ts";
import {
  buildAnalyticsSalesMetricBuckets,
  type AnalyticsSalesAggregateRow,
  type AnalyticsSalesMetricBucket,
} from "./analytics-sales-values.ts";

interface AnalyticsBranchAggregateRow extends AnalyticsSalesAggregateRow {
  branchId: string;
  branchName: string;
  branchStatus: "ACTIVE" | "INACTIVE";
}

export interface AnalyticsBranchSeries {
  branchId: string;
  branchName: string;
  branchStatus: "ACTIVE" | "INACTIVE";
  buckets: readonly AnalyticsSalesMetricBucket[];
}

export interface AnalyticsBranchPage {
  context: AnalyticsExecutionContext;
  metricDefinitionVersion: "analytics-v1";
  nextCursor: string | null;
  series: readonly AnalyticsBranchSeries[];
}

export interface AnalyticsBranchRepository {
  read(
    context: AnalyticsExecutionContext,
    limit: number,
    afterId: string | null,
  ): Promise<AnalyticsBranchPage>;
}

export function createPrismaAnalyticsBranchRepository(
  prisma: Pick<PrismaClient, "$queryRaw">,
  cursorCodec: AnalyticsDimensionCursorCodec,
): AnalyticsBranchRepository {
  return {
    async read(context, limit, afterId) {
      const comparisonBucket = createAnalyticsComparisonBucket(context.period);
      const bounds = [comparisonBucket, ...context.period.buckets].map(
        (bucket, index) => Prisma.sql`(
        ${index - 1}::integer, ${bucket.bucketStartInclusive}::timestamptz,
        ${bucket.bucketEndExclusive}::timestamptz
      )`,
      );
      const branchIds = context.scope.branchIds.map(
        (id) => Prisma.sql`${id}::uuid`,
      );

      // Page selection, sale and refund aggregates, and display state use one snapshot.
      const rows = await prisma.$queryRaw<
        AnalyticsBranchAggregateRow[]
      >(Prisma.sql`
        WITH bucket_bounds (bucket_index, start_inclusive, end_exclusive) AS (
          VALUES ${Prisma.join(bounds)}
        ),
        page AS (
          SELECT id, name, status FROM branches
          WHERE organization_id = ${context.scope.organizationId}::uuid
            AND id IN (${Prisma.join(branchIds)})
            AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
          ORDER BY id ASC
          LIMIT ${limit + 1}
        ),
        sale_metrics AS (
          SELECT buckets.bucket_index, page.id AS branch_id,
            COALESCE(SUM(items.line_gross), 0)::numeric AS gross,
            COALESCE(SUM(items.line_discount), 0)::numeric AS discount,
            COALESCE(SUM(items.line_net), 0)::numeric AS sales,
            COALESCE(SUM(items.line_output_vat), 0)::numeric AS vat,
            SUM(items.line_taxable)::numeric AS taxable,
            COUNT(DISTINCT sales.id)::bigint AS sale_count,
            COALESCE(SUM(items.cogs_amount), 0)::numeric AS cogs,
            COUNT(items.id) FILTER (WHERE items.cogs_amount IS NOT NULL)::bigint AS known_cost_lines,
            COUNT(items.id) FILTER (WHERE items.cogs_amount IS NULL)::bigint AS unknown_cost_lines
          FROM page CROSS JOIN bucket_bounds AS buckets
          LEFT JOIN sales ON sales.organization_id = ${context.scope.organizationId}::uuid
            AND sales.branch_id = page.id
            AND sales.completed_at >= buckets.start_inclusive
            AND sales.completed_at < buckets.end_exclusive
            AND sales.completed_at <= ${context.period.sourceCutoff}::timestamptz
          LEFT JOIN sale_items AS items ON items.sale_id = sales.id
            AND items.organization_id = sales.organization_id
            AND items.branch_id = sales.branch_id
          GROUP BY buckets.bucket_index, page.id
        ),
        refund_metrics AS (
          SELECT buckets.bucket_index, page.id AS branch_id,
            COALESCE(SUM(items.reversed_line_net), 0)::numeric AS refunds,
            COALESCE(SUM(items.reversed_line_discount), 0)::numeric AS refund_discount,
            COALESCE(SUM(items.reversed_line_output_vat), 0)::numeric AS refund_vat,
            SUM(items.reversed_line_taxable)::numeric AS refund_taxable,
            COUNT(DISTINCT refunds.id)::bigint AS refund_count,
            COUNT(DISTINCT refunds.sale_id)::bigint AS refunded_sale_count,
            COALESCE(SUM(items.cogs_reversal_amount) FILTER (
              WHERE items.restock_quantity > 0 AND items.cogs_reversal_amount IS NOT NULL
            ), 0)::numeric AS refund_cogs,
            COUNT(items.id) FILTER (
              WHERE items.restock_quantity > 0 AND items.cogs_reversal_amount IS NOT NULL
            )::bigint AS known_refund_cost_lines,
            COUNT(items.id) FILTER (
              WHERE items.restock_quantity > 0 AND items.cogs_reversal_amount IS NULL
            )::bigint AS unknown_refund_cost_lines
          FROM page CROSS JOIN bucket_bounds AS buckets
          LEFT JOIN sale_refunds AS refunds ON refunds.organization_id = ${context.scope.organizationId}::uuid
            AND refunds.branch_id = page.id
            AND refunds.completed_at >= buckets.start_inclusive
            AND refunds.completed_at < buckets.end_exclusive
            AND refunds.completed_at <= ${context.period.sourceCutoff}::timestamptz
          LEFT JOIN sale_refund_items AS items ON items.sale_refund_id = refunds.id
            AND items.organization_id = refunds.organization_id
            AND items.branch_id = refunds.branch_id
            AND items.sale_id = refunds.sale_id
          GROUP BY buckets.bucket_index, page.id
        )
        SELECT page.id::text AS "branchId", page.name AS "branchName",
          page.status::text AS "branchStatus",
          sales.bucket_index AS "bucketIndex",
          sales.gross AS "grossSalesAmount",
          sales.discount AS "discountAmount",
          sales.sales AS "salesAfterDiscountAmount",
          sales.vat AS "outputVatAmount",
          sales.taxable AS "registeredTaxableSalesAmount",
          sales.sale_count AS "saleCount",
          sales.cogs AS "saleCogsAmount",
          sales.known_cost_lines AS "knownSaleCostLineCount",
          sales.unknown_cost_lines AS "unknownSaleCostLineCount",
          refunds.refunds AS "refundAmount",
          refunds.refund_discount AS "refundedDiscountAmount",
          refunds.refund_vat AS "refundedOutputVatAmount",
          refunds.refund_taxable AS "refundedRegisteredTaxableAmount",
          refunds.refund_count AS "refundCount",
          refunds.refunded_sale_count AS "refundedSaleCount",
          refunds.refund_cogs AS "refundCogsReversalAmount",
          refunds.known_refund_cost_lines AS "knownRefundCostLineCount",
          refunds.unknown_refund_cost_lines AS "unknownRefundCostLineCount"
        FROM page
        CROSS JOIN bucket_bounds AS buckets
        JOIN sale_metrics AS sales ON sales.branch_id = page.id
          AND sales.bucket_index = buckets.bucket_index
        JOIN refund_metrics AS refunds ON refunds.branch_id = page.id
          AND refunds.bucket_index = buckets.bucket_index
        ORDER BY page.id ASC, buckets.bucket_index ASC
      `);

      const grouped = new Map<string, AnalyticsBranchAggregateRow[]>();
      for (const row of rows) {
        const group = grouped.get(row.branchId) ?? [];
        group.push(row);
        grouped.set(row.branchId, group);
      }
      const pageGroups = [...grouped.values()];
      const selected = pageGroups.slice(0, limit);
      const lastId = selected.at(-1)?.[0]?.branchId;
      return Object.freeze({
        context,
        metricDefinitionVersion: context.period.metricDefinitionVersion,
        nextCursor:
          pageGroups.length > limit && lastId !== undefined
            ? cursorCodec.encode({
                context,
                dimension: "branch",
                lastId,
              })
            : null,
        series: Object.freeze(
          selected.map((group) => {
            const first = group[0]!;
            return Object.freeze({
              branchId: first.branchId,
              branchName: first.branchName,
              branchStatus: first.branchStatus,
              buckets: buildAnalyticsSalesMetricBuckets({
                buckets: context.period.buckets,
                canViewCost: context.scope.canViewCost,
                comparisonBucket,
                rows: group,
              }),
            });
          }),
        ),
      });
    },
  };
}
