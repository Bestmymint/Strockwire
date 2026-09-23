import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.ts";
import {
  buildAnalyticsCategorySeries,
  type AnalyticsCategoryAggregateRow,
} from "./analytics-category-values.ts";
import { createAnalyticsPeriodContext } from "./analytics-period.ts";

const period = createAnalyticsPeriodContext({
  from: "2026-09-20",
  granularity: "day",
  reportingTimezone: "Asia/Bangkok",
  sourceCutoff: new Date("2026-09-22T00:00:00.000Z"),
  to: "2026-09-21",
});

function row(
  sales: string,
  denominator: string,
  refund: string,
): AnalyticsCategoryAggregateRow {
  return {
    bucketIndex: 0,
    categoryId: null,
    categoryName: null,
    categoryStatus: null,
    discountAmount: new Prisma.Decimal("0"),
    grossSalesAmount: new Prisma.Decimal(sales),
    refundAmount: new Prisma.Decimal(refund),
    salesAfterDiscountAmount: new Prisma.Decimal(sales),
    totalSalesAfterDiscountAmount: new Prisma.Decimal(denominator),
  };
}

describe("category money and share values", () => {
  it("uses exact sales share independent of refunds and HALF_UP rounding", () => {
    const result = buildAnalyticsCategorySeries({
      buckets: period.buckets,
      rows: [row("1", "6", "2")],
    });
    expect(result).toMatchObject({
      categoryKind: "UNCATEGORIZED",
      categoryName: "UNCATEGORIZED",
    });
    expect(result.buckets[0]).toMatchObject({
      categorySharePercent: { reason: null, value: "16.67" },
      netSalesAmount: "-1.00",
      refundAmount: "2.00",
    });
  });

  it("returns NO_SALES only for a zero denominator", () => {
    expect(
      buildAnalyticsCategorySeries({
        buckets: period.buckets,
        rows: [row("0", "0", "3")],
      }).buckets[0]?.categorySharePercent,
    ).toEqual({ reason: "NO_SALES", value: null });
  });

  it("does not force independently rounded shares to total 100.00", () => {
    const shares = ["1", "1", "1"].map(
      (value) =>
        buildAnalyticsCategorySeries({
          buckets: period.buckets,
          rows: [row(value, "3", "0")],
        }).buckets[0]!.categorySharePercent.value,
    );
    expect(shares).toEqual(["33.33", "33.33", "33.33"]);
  });
});
