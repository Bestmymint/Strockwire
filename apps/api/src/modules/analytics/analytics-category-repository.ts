import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { AnalyticsExecutionContext } from "./analytics-context.ts";
import {
  buildAnalyticsCategorySeries,
  type AnalyticsCategoryAggregateRow,
  type AnalyticsCategorySeries,
} from "./analytics-category-values.ts";
import type { AnalyticsDimensionCursorCodec } from "./analytics-dimension-cursor.ts";

export interface AnalyticsCategoryPage {
  context: AnalyticsExecutionContext;
  metricDefinitionVersion: "analytics-v1";
  nextCursor: string | null;
  series: readonly AnalyticsCategorySeries[];
}

export interface AnalyticsCategoryRepository {
  read(
    context: AnalyticsExecutionContext,
    limit: number,
    afterId: string | null,
  ): Promise<AnalyticsCategoryPage>;
}

export function createPrismaAnalyticsCategoryRepository(
  prisma: Pick<PrismaClient, "$queryRaw">,
  cursorCodec: AnalyticsDimensionCursorCodec,
): AnalyticsCategoryRepository {
  return {
    async read(context, limit, afterId) {
      const bounds = context.period.buckets.map(
        (bucket, index) => Prisma.sql`(
        ${index}::integer, ${bucket.bucketStartInclusive}::timestamptz,
        ${bucket.bucketEndExclusive}::timestamptz
      )`,
      );
      const branchIds = context.scope.branchIds.map(
        (id) => Prisma.sql`${id}::uuid`,
      );

      // The page, its bucket totals, and the share denominator share one MVCC snapshot.
      const rows = await prisma.$queryRaw<
        AnalyticsCategoryAggregateRow[]
      >(Prisma.sql`
        WITH bucket_bounds (bucket_index, start_inclusive, end_exclusive) AS (
          VALUES ${Prisma.join(bounds)}
        ),
        sale_facts AS (
          SELECT buckets.bucket_index, products.category_id,
            SUM(items.line_gross)::numeric AS gross,
            SUM(items.line_discount)::numeric AS discount,
            SUM(items.line_net)::numeric AS sales
          FROM bucket_bounds AS buckets
          JOIN sales ON sales.organization_id = ${context.scope.organizationId}::uuid
            AND sales.branch_id IN (${Prisma.join(branchIds)})
            AND sales.completed_at >= buckets.start_inclusive
            AND sales.completed_at < buckets.end_exclusive
            AND sales.completed_at <= ${context.period.sourceCutoff}::timestamptz
          JOIN sale_items AS items ON items.sale_id = sales.id
            AND items.organization_id = sales.organization_id
            AND items.branch_id = sales.branch_id
          JOIN products ON products.id = items.product_id
            AND products.organization_id = items.organization_id
          GROUP BY buckets.bucket_index, products.category_id
        ),
        refund_facts AS (
          SELECT buckets.bucket_index, products.category_id,
            SUM(items.reversed_line_net)::numeric AS refunds
          FROM bucket_bounds AS buckets
          JOIN sale_refunds AS refund ON refund.organization_id = ${context.scope.organizationId}::uuid
            AND refund.branch_id IN (${Prisma.join(branchIds)})
            AND refund.completed_at >= buckets.start_inclusive
            AND refund.completed_at < buckets.end_exclusive
            AND refund.completed_at <= ${context.period.sourceCutoff}::timestamptz
          JOIN sale_refund_items AS items ON items.sale_refund_id = refund.id
            AND items.organization_id = refund.organization_id
            AND items.branch_id = refund.branch_id
            AND items.sale_id = refund.sale_id
          JOIN products ON products.id = items.product_id
            AND products.organization_id = items.organization_id
          GROUP BY buckets.bucket_index, products.category_id
        ),
        dimensions AS (
          SELECT category_id FROM sale_facts
          UNION
          SELECT category_id FROM refund_facts
        ),
        page AS (
          SELECT category_id FROM dimensions
          WHERE ${afterId}::uuid IS NULL OR category_id > ${afterId}::uuid OR category_id IS NULL
          ORDER BY category_id ASC NULLS LAST
          LIMIT ${limit + 1}
        ),
        bucket_totals AS (
          SELECT bucket_index, SUM(sales)::numeric AS sales FROM sale_facts GROUP BY bucket_index
        )
        SELECT buckets.bucket_index AS "bucketIndex",
          page.category_id::text AS "categoryId",
          categories.name AS "categoryName",
          categories.status::text AS "categoryStatus",
          COALESCE(sale_facts.gross, 0)::numeric AS "grossSalesAmount",
          COALESCE(sale_facts.discount, 0)::numeric AS "discountAmount",
          COALESCE(sale_facts.sales, 0)::numeric AS "salesAfterDiscountAmount",
          COALESCE(refund_facts.refunds, 0)::numeric AS "refundAmount",
          COALESCE(bucket_totals.sales, 0)::numeric AS "totalSalesAfterDiscountAmount"
        FROM page
        CROSS JOIN bucket_bounds AS buckets
        LEFT JOIN categories ON categories.id = page.category_id
          AND categories.organization_id = ${context.scope.organizationId}::uuid
        LEFT JOIN sale_facts ON sale_facts.bucket_index = buckets.bucket_index
          AND sale_facts.category_id IS NOT DISTINCT FROM page.category_id
        LEFT JOIN refund_facts ON refund_facts.bucket_index = buckets.bucket_index
          AND refund_facts.category_id IS NOT DISTINCT FROM page.category_id
        LEFT JOIN bucket_totals ON bucket_totals.bucket_index = buckets.bucket_index
        ORDER BY page.category_id ASC NULLS LAST, buckets.bucket_index ASC
      `);

      const grouped = new Map<string, AnalyticsCategoryAggregateRow[]>();
      for (const row of rows) {
        const key = row.categoryId ?? "UNCATEGORIZED";
        const group = grouped.get(key) ?? [];
        group.push(row);
        grouped.set(key, group);
      }
      const pageGroups = [...grouped.values()];
      const selected = pageGroups.slice(0, limit);
      const lastId = selected.at(-1)?.[0]?.categoryId;
      return Object.freeze({
        context,
        metricDefinitionVersion: context.period.metricDefinitionVersion,
        nextCursor:
          pageGroups.length > limit && lastId !== undefined
            ? cursorCodec.encode({
                context,
                dimension: "category",
                lastId,
              })
            : null,
        series: Object.freeze(
          selected.map((group) =>
            buildAnalyticsCategorySeries({
              buckets: context.period.buckets,
              rows: group,
            }),
          ),
        ),
      });
    },
  };
}
