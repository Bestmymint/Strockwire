import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.ts";
import {
  createAnalyticsComparisonBucket,
  createAnalyticsPeriodContext,
} from "./analytics-period.ts";
import {
  buildAnalyticsSalesMetricBuckets,
  zeroAnalyticsSalesAggregateRow,
  type AnalyticsSalesAggregateRow,
} from "./analytics-sales-values.ts";

const decimal = (value: string) => new Prisma.Decimal(value);

function metricFixture(input: {
  canViewCost?: boolean;
  cutoff?: string;
  from?: string;
  rows: readonly AnalyticsSalesAggregateRow[];
  to?: string;
}) {
  const period = createAnalyticsPeriodContext({
    from: input.from ?? "2026-09-20",
    granularity: "day",
    reportingTimezone: "Asia/Bangkok",
    sourceCutoff: new Date(input.cutoff ?? "2026-09-23T00:00:00.000Z"),
    to: input.to ?? "2026-09-21",
  });
  return buildAnalyticsSalesMetricBuckets({
    buckets: period.buckets,
    canViewCost: input.canViewCost ?? true,
    comparisonBucket: createAnalyticsComparisonBucket(period),
    rows: input.rows,
  });
}

describe("analytics sales metric values", () => {
  it("derives exact VAT-inclusive totals, counts, AOV, growth, and complete cost metrics", () => {
    const comparison = {
      ...zeroAnalyticsSalesAggregateRow(-1),
      saleCount: 1n,
      salesAfterDiscountAmount: decimal("100.00"),
    };
    const current = {
      ...zeroAnalyticsSalesAggregateRow(0),
      discountAmount: decimal("107.00"),
      grossSalesAmount: decimal("1070.00"),
      knownRefundCostLineCount: 1n,
      knownSaleCostLineCount: 1n,
      outputVatAmount: decimal("63.00"),
      refundAmount: decimal("53.50"),
      refundCogsReversalAmount: decimal("30.0000000000"),
      refundCount: 2n,
      refundedDiscountAmount: decimal("5.95"),
      refundedOutputVatAmount: decimal("1.75"),
      refundedRegisteredTaxableAmount: decimal("25.00"),
      refundedSaleCount: 1n,
      registeredTaxableSalesAmount: decimal("900.00"),
      saleCogsAmount: decimal("500.0000000000"),
      saleCount: 1n,
      salesAfterDiscountAmount: decimal("963.00"),
    };

    const [bucket] = metricFixture({ rows: [comparison, current] });

    expect(bucket).toMatchObject({
      averageOrderValue: { reason: null, value: "963.00" },
      discountAmount: "107.00",
      grossSalesAmount: "1070.00",
      netOutputVatAmount: "61.25",
      netSalesAmount: "909.50",
      netSalesGrowthPercent: { reason: null, value: "809.50" },
      outputVatAmount: "63.00",
      refundAmount: "53.50",
      refundCount: 2,
      refundedDiscountAmount: "5.95",
      refundedOutputVatAmount: "1.75",
      refundedRegisteredTaxableAmount: { reason: null, value: "25.00" },
      refundedSaleCount: 1,
      registeredTaxableSalesAmount: { reason: null, value: "900.00" },
      saleCount: 1,
      salesAfterDiscountAmount: "963.00",
    });
    expect(bucket?.cost).toEqual({
      costCoverage: "complete",
      grossMarginPercent: { reason: null, value: "48.32" },
      grossProfitAmount: { reason: null, value: "439.5000000000" },
      knownCostLineCount: 2,
      knownNetCogsAmount: "470.0000000000",
      netCogsAmount: { reason: null, value: "470.0000000000" },
      refundCogsReversalAmount: "30.0000000000",
      saleCogsAmount: "500.0000000000",
      unknownCostLineCount: 0,
    });
  });

  it("keeps an old-Sale refund in its own period and allows negative Net Sales", () => {
    const current = {
      ...zeroAnalyticsSalesAggregateRow(0),
      refundAmount: decimal("80.00"),
      refundCount: 1n,
      refundedSaleCount: 1n,
    };
    const [bucket] = metricFixture({
      rows: [zeroAnalyticsSalesAggregateRow(-1), current],
    });

    expect(bucket).toMatchObject({
      averageOrderValue: { reason: "NO_SALES", value: null },
      grossSalesAmount: "0.00",
      netSalesAmount: "-80.00",
      refundAmount: "80.00",
      refundCount: 1,
      refundedSaleCount: 1,
      saleCount: 0,
      salesAfterDiscountAmount: "0.00",
    });
    expect(bucket?.cost).toMatchObject({
      costCoverage: "complete",
      grossMarginPercent: {
        reason: "NON_POSITIVE_NET_SALES",
        value: null,
      },
      grossProfitAmount: { reason: null, value: "-80.0000000000" },
      netCogsAmount: { reason: null, value: "0.0000000000" },
    });
  });

  it("reports a null margin for a zero-sales bucket instead of NaN", () => {
    const [bucket] = metricFixture({
      rows: [
        zeroAnalyticsSalesAggregateRow(-1),
        zeroAnalyticsSalesAggregateRow(0),
      ],
    });
    expect(bucket?.netSalesAmount).toBe("0.00");
    expect(bucket?.cost?.grossMarginPercent).toEqual({
      reason: "NON_POSITIVE_NET_SALES",
      value: null,
    });
  });

  it("does not fabricate cost when a required historical cost fact is unknown", () => {
    const current = {
      ...zeroAnalyticsSalesAggregateRow(0),
      grossSalesAmount: decimal("120.00"),
      saleCount: 1n,
      salesAfterDiscountAmount: decimal("120.00"),
      unknownSaleCostLineCount: 1n,
    };
    const [bucket] = metricFixture({
      rows: [zeroAnalyticsSalesAggregateRow(-1), current],
    });

    expect(bucket?.cost).toEqual({
      costCoverage: "none",
      grossMarginPercent: {
        reason: "INCOMPLETE_COST_COVERAGE",
        value: null,
      },
      grossProfitAmount: {
        reason: "INCOMPLETE_COST_COVERAGE",
        value: null,
      },
      knownCostLineCount: 0,
      knownNetCogsAmount: "0.0000000000",
      netCogsAmount: {
        reason: "INCOMPLETE_COST_COVERAGE",
        value: null,
      },
      refundCogsReversalAmount: "0.0000000000",
      saleCogsAmount: "0.0000000000",
      unknownCostLineCount: 1,
    });
  });

  it("gap-fills exact zero, rounds only final ratios, and suppresses partial growth", () => {
    const first = {
      ...zeroAnalyticsSalesAggregateRow(0),
      grossSalesAmount: decimal("1.01"),
      saleCount: 3n,
      salesAfterDiscountAmount: decimal("1.01"),
    };
    const rows = metricFixture({
      cutoff: "2026-09-21T12:00:00.000Z",
      rows: [
        zeroAnalyticsSalesAggregateRow(-1),
        first,
        zeroAnalyticsSalesAggregateRow(1),
      ],
      to: "2026-09-22",
    });

    expect(rows[0]).toMatchObject({
      averageOrderValue: { reason: null, value: "0.34" },
      dataStatus: "complete",
      netSalesGrowthPercent: { reason: "NO_BASELINE", value: null },
    });
    expect(rows[1]).toMatchObject({
      averageOrderValue: { reason: "NO_SALES", value: null },
      dataStatus: "partial",
      grossSalesAmount: "0.00",
      netSalesGrowthPercent: {
        reason: "NON_COMPARABLE_PERIOD",
        value: null,
      },
    });
  });

  it("omits cost fields when the resolved scope lacks cost capability", () => {
    const [bucket] = metricFixture({
      canViewCost: false,
      rows: [
        zeroAnalyticsSalesAggregateRow(-1),
        zeroAnalyticsSalesAggregateRow(0),
      ],
    });

    expect(bucket).not.toHaveProperty("cost");
  });
});
