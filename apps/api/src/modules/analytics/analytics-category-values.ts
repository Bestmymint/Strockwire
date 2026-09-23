import { Prisma } from "../../generated/prisma/client.ts";
import type { AnalyticsPeriodBucket } from "./analytics-period.ts";
import type { NullableAnalyticsMetric } from "./analytics-sales-values.ts";

const ExactDecimal = Prisma.Decimal.clone({ precision: 80 });

export interface AnalyticsCategoryAggregateRow {
  bucketIndex: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryStatus: "ACTIVE" | "INACTIVE" | null;
  discountAmount: Prisma.Decimal;
  grossSalesAmount: Prisma.Decimal;
  refundAmount: Prisma.Decimal;
  salesAfterDiscountAmount: Prisma.Decimal;
  totalSalesAfterDiscountAmount: Prisma.Decimal;
}

export interface AnalyticsCategoryMetricBucket {
  bucketEndExclusive: Date;
  bucketStartInclusive: Date;
  categorySharePercent: NullableAnalyticsMetric;
  dataStatus: AnalyticsPeriodBucket["dataStatus"];
  discountAmount: string;
  grossSalesAmount: string;
  label: string;
  localEndExclusive: string;
  localStartInclusive: string;
  netSalesAmount: string;
  refundAmount: string;
  salesAfterDiscountAmount: string;
}

export interface AnalyticsCategorySeries {
  buckets: readonly AnalyticsCategoryMetricBucket[];
  categoryId: string | null;
  categoryKind: "CATEGORY" | "UNCATEGORIZED";
  categoryName: string;
  categoryStatus: "ACTIVE" | "INACTIVE" | null;
}

export function buildAnalyticsCategorySeries(input: {
  buckets: readonly AnalyticsPeriodBucket[];
  rows: readonly AnalyticsCategoryAggregateRow[];
}): AnalyticsCategorySeries {
  const first = input.rows[0];
  if (first === undefined) throw new Error("Category series has no buckets.");
  if (
    first.categoryId !== null &&
    (first.categoryName === null || first.categoryStatus === null)
  ) {
    throw new Error("Category dimension is missing.");
  }
  const rowsByIndex = new Map(input.rows.map((row) => [row.bucketIndex, row]));
  return Object.freeze({
    buckets: Object.freeze(
      input.buckets.map((bucket, index) => {
        const row = rowsByIndex.get(index);
        if (row === undefined)
          throw new Error("Category aggregate bucket is missing.");
        const sales = new ExactDecimal(row.salesAfterDiscountAmount);
        const refund = new ExactDecimal(row.refundAmount);
        const denominator = new ExactDecimal(row.totalSalesAfterDiscountAmount);
        return Object.freeze({
          bucketEndExclusive: new Date(bucket.bucketEndExclusive),
          bucketStartInclusive: new Date(bucket.bucketStartInclusive),
          categorySharePercent: denominator.isZero()
            ? { reason: "NO_SALES" as const, value: null }
            : {
                reason: null,
                value: sales
                  .dividedBy(denominator)
                  .times(100)
                  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                  .toFixed(2),
              },
          dataStatus: bucket.dataStatus,
          discountAmount: new ExactDecimal(row.discountAmount).toFixed(2),
          grossSalesAmount: new ExactDecimal(row.grossSalesAmount).toFixed(2),
          label: bucket.label,
          localEndExclusive: bucket.localEndExclusive,
          localStartInclusive: bucket.localStartInclusive,
          netSalesAmount: sales.minus(refund).toFixed(2),
          refundAmount: refund.toFixed(2),
          salesAfterDiscountAmount: sales.toFixed(2),
        });
      }),
    ),
    categoryId: first.categoryId,
    categoryKind:
      first.categoryId === null
        ? ("UNCATEGORIZED" as const)
        : ("CATEGORY" as const),
    categoryName:
      first.categoryId === null ? "UNCATEGORIZED" : first.categoryName!,
    categoryStatus: first.categoryId === null ? null : first.categoryStatus,
  });
}
