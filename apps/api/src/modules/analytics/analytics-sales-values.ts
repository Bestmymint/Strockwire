import { Prisma } from "../../generated/prisma/client.ts";
import type {
  AnalyticsBaseDataStatus,
  AnalyticsPeriodBucket,
} from "./analytics-period.ts";

const ExactDecimal = Prisma.Decimal.clone({ precision: 80 });

export type AnalyticsMetricReason =
  | "INCOMPLETE_COST_COVERAGE"
  | "NO_BASELINE"
  | "NON_COMPARABLE_PERIOD"
  | "NON_POSITIVE_NET_SALES"
  | "NO_REGISTERED_REFUNDS"
  | "NO_REGISTERED_SALES"
  | "NO_SALES";

export interface NullableAnalyticsMetric {
  reason: AnalyticsMetricReason | null;
  value: string | null;
}

export type AnalyticsCostCoverage = "complete" | "none" | "partial";

export interface AnalyticsSalesAggregateRow {
  bucketIndex: number;
  discountAmount: Prisma.Decimal;
  grossSalesAmount: Prisma.Decimal;
  knownRefundCostLineCount: bigint;
  knownSaleCostLineCount: bigint;
  outputVatAmount: Prisma.Decimal;
  refundAmount: Prisma.Decimal;
  refundCogsReversalAmount: Prisma.Decimal;
  refundCount: bigint;
  refundedDiscountAmount: Prisma.Decimal;
  refundedOutputVatAmount: Prisma.Decimal;
  refundedRegisteredTaxableAmount: Prisma.Decimal | null;
  refundedSaleCount: bigint;
  registeredTaxableSalesAmount: Prisma.Decimal | null;
  saleCogsAmount: Prisma.Decimal;
  saleCount: bigint;
  salesAfterDiscountAmount: Prisma.Decimal;
  unknownRefundCostLineCount: bigint;
  unknownSaleCostLineCount: bigint;
}

export interface AnalyticsSalesCostMetrics {
  costCoverage: AnalyticsCostCoverage;
  grossMarginPercent: NullableAnalyticsMetric;
  grossProfitAmount: NullableAnalyticsMetric;
  knownCostLineCount: number;
  knownNetCogsAmount: string;
  netCogsAmount: NullableAnalyticsMetric;
  refundCogsReversalAmount: string;
  saleCogsAmount: string;
  unknownCostLineCount: number;
}

export interface AnalyticsSalesMetricBucket {
  averageOrderValue: NullableAnalyticsMetric;
  bucketEndExclusive: Date;
  bucketStartInclusive: Date;
  cost?: AnalyticsSalesCostMetrics;
  dataStatus: AnalyticsBaseDataStatus;
  discountAmount: string;
  grossSalesAmount: string;
  label: string;
  localEndExclusive: string;
  localStartInclusive: string;
  netOutputVatAmount: string;
  netSalesAmount: string;
  netSalesGrowthPercent: NullableAnalyticsMetric;
  outputVatAmount: string;
  refundAmount: string;
  refundCount: number;
  refundedDiscountAmount: string;
  refundedOutputVatAmount: string;
  refundedRegisteredTaxableAmount: NullableAnalyticsMetric;
  refundedSaleCount: number;
  registeredTaxableSalesAmount: NullableAnalyticsMetric;
  saleCount: number;
  salesAfterDiscountAmount: string;
}

function decimal(value: Prisma.Decimal): InstanceType<typeof ExactDecimal> {
  return new ExactDecimal(value);
}

function money(value: InstanceType<typeof ExactDecimal>): string {
  return value.toFixed(2);
}

function cost(value: InstanceType<typeof ExactDecimal>): string {
  return value.toFixed(10);
}

function safeCount(value: bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "Analytics aggregate count exceeded the safe integer range.",
    );
  }
  return count;
}

function nullableValue(
  value: InstanceType<typeof ExactDecimal> | null,
  reason: AnalyticsMetricReason,
  scale: 2 | 10 = 2,
): NullableAnalyticsMetric {
  return value === null
    ? { reason, value: null }
    : { reason: null, value: scale === 2 ? money(value) : cost(value) };
}

function averageOrderValue(
  salesAfterDiscount: InstanceType<typeof ExactDecimal>,
  saleCount: number,
): NullableAnalyticsMetric {
  if (saleCount === 0) {
    return { reason: "NO_SALES", value: null };
  }

  return {
    reason: null,
    value: salesAfterDiscount
      .dividedBy(saleCount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2),
  };
}

function growth(input: {
  baseline: InstanceType<typeof ExactDecimal>;
  baselineStatus: AnalyticsBaseDataStatus;
  current: InstanceType<typeof ExactDecimal>;
  currentStatus: AnalyticsBaseDataStatus;
}): NullableAnalyticsMetric {
  if (
    input.baselineStatus !== "complete" ||
    input.currentStatus !== "complete"
  ) {
    return { reason: "NON_COMPARABLE_PERIOD", value: null };
  }
  if (input.baseline.isZero()) {
    return input.current.isZero()
      ? { reason: null, value: "0.00" }
      : { reason: "NO_BASELINE", value: null };
  }

  return {
    reason: null,
    value: input.current
      .minus(input.baseline)
      .dividedBy(input.baseline.abs())
      .times(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2),
  };
}

function costCoverage(known: number, unknown: number): AnalyticsCostCoverage {
  if (unknown === 0) return "complete";
  return known === 0 ? "none" : "partial";
}

function buildCostMetrics(input: {
  netSales: InstanceType<typeof ExactDecimal>;
  row: AnalyticsSalesAggregateRow;
}): AnalyticsSalesCostMetrics {
  const knownCostLineCount = safeCount(
    input.row.knownSaleCostLineCount + input.row.knownRefundCostLineCount,
  );
  const unknownCostLineCount = safeCount(
    input.row.unknownSaleCostLineCount + input.row.unknownRefundCostLineCount,
  );
  const coverage = costCoverage(knownCostLineCount, unknownCostLineCount);
  const saleCogs = decimal(input.row.saleCogsAmount);
  const refundCogs = decimal(input.row.refundCogsReversalAmount);
  const knownNetCogs = saleCogs.minus(refundCogs);

  if (coverage !== "complete") {
    const unavailable = {
      reason: "INCOMPLETE_COST_COVERAGE" as const,
      value: null,
    };
    return {
      costCoverage: coverage,
      grossMarginPercent: unavailable,
      grossProfitAmount: unavailable,
      knownCostLineCount,
      knownNetCogsAmount: cost(knownNetCogs),
      netCogsAmount: unavailable,
      refundCogsReversalAmount: cost(refundCogs),
      saleCogsAmount: cost(saleCogs),
      unknownCostLineCount,
    };
  }

  const grossProfit = input.netSales.minus(knownNetCogs);
  const grossMarginPercent = input.netSales.greaterThan(0)
    ? {
        reason: null,
        value: grossProfit
          .dividedBy(input.netSales)
          .times(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(2),
      }
    : { reason: "NON_POSITIVE_NET_SALES" as const, value: null };

  return {
    costCoverage: coverage,
    grossMarginPercent,
    grossProfitAmount: nullableValue(
      grossProfit,
      "INCOMPLETE_COST_COVERAGE",
      10,
    ),
    knownCostLineCount,
    knownNetCogsAmount: cost(knownNetCogs),
    netCogsAmount: nullableValue(knownNetCogs, "INCOMPLETE_COST_COVERAGE", 10),
    refundCogsReversalAmount: cost(refundCogs),
    saleCogsAmount: cost(saleCogs),
    unknownCostLineCount,
  };
}

export function buildAnalyticsSalesMetricBuckets(input: {
  buckets: readonly AnalyticsPeriodBucket[];
  canViewCost: boolean;
  comparisonBucket: AnalyticsPeriodBucket;
  rows: readonly AnalyticsSalesAggregateRow[];
}): readonly AnalyticsSalesMetricBucket[] {
  const rowsByIndex = new Map(input.rows.map((row) => [row.bucketIndex, row]));
  const comparisonRow = rowsByIndex.get(-1);
  if (comparisonRow === undefined) {
    throw new Error("Analytics comparison aggregate is missing.");
  }

  let baselineNetSales = decimal(comparisonRow.salesAfterDiscountAmount).minus(
    comparisonRow.refundAmount,
  );
  let baselineStatus = input.comparisonBucket.dataStatus;

  return Object.freeze(
    input.buckets.map((bucket, bucketIndex) => {
      const row = rowsByIndex.get(bucketIndex);
      if (row === undefined) {
        throw new Error(
          `Analytics aggregate bucket ${bucketIndex} is missing.`,
        );
      }

      const grossSales = decimal(row.grossSalesAmount);
      const discount = decimal(row.discountAmount);
      const salesAfterDiscount = decimal(row.salesAfterDiscountAmount);
      const refundAmount = decimal(row.refundAmount);
      const netSales = salesAfterDiscount.minus(refundAmount);
      const outputVat = decimal(row.outputVatAmount);
      const refundedOutputVat = decimal(row.refundedOutputVatAmount);
      const saleCount = safeCount(row.saleCount);
      const result: AnalyticsSalesMetricBucket = {
        averageOrderValue: averageOrderValue(salesAfterDiscount, saleCount),
        bucketEndExclusive: new Date(bucket.bucketEndExclusive.getTime()),
        bucketStartInclusive: new Date(bucket.bucketStartInclusive.getTime()),
        dataStatus: bucket.dataStatus,
        discountAmount: money(discount),
        grossSalesAmount: money(grossSales),
        label: bucket.label,
        localEndExclusive: bucket.localEndExclusive,
        localStartInclusive: bucket.localStartInclusive,
        netOutputVatAmount: money(outputVat.minus(refundedOutputVat)),
        netSalesAmount: money(netSales),
        netSalesGrowthPercent: growth({
          baseline: baselineNetSales,
          baselineStatus,
          current: netSales,
          currentStatus: bucket.dataStatus,
        }),
        outputVatAmount: money(outputVat),
        refundAmount: money(refundAmount),
        refundCount: safeCount(row.refundCount),
        refundedDiscountAmount: money(decimal(row.refundedDiscountAmount)),
        refundedOutputVatAmount: money(refundedOutputVat),
        refundedRegisteredTaxableAmount: nullableValue(
          row.refundedRegisteredTaxableAmount === null
            ? null
            : decimal(row.refundedRegisteredTaxableAmount),
          "NO_REGISTERED_REFUNDS",
        ),
        refundedSaleCount: safeCount(row.refundedSaleCount),
        registeredTaxableSalesAmount: nullableValue(
          row.registeredTaxableSalesAmount === null
            ? null
            : decimal(row.registeredTaxableSalesAmount),
          "NO_REGISTERED_SALES",
        ),
        saleCount,
        salesAfterDiscountAmount: money(salesAfterDiscount),
        ...(input.canViewCost
          ? { cost: buildCostMetrics({ netSales, row }) }
          : {}),
      };

      baselineNetSales = netSales;
      baselineStatus = bucket.dataStatus;
      return Object.freeze(result);
    }),
  );
}

export function zeroAnalyticsSalesAggregateRow(
  bucketIndex: number,
): AnalyticsSalesAggregateRow {
  const zero = new Prisma.Decimal(0);
  return {
    bucketIndex,
    discountAmount: zero,
    grossSalesAmount: zero,
    knownRefundCostLineCount: 0n,
    knownSaleCostLineCount: 0n,
    outputVatAmount: zero,
    refundAmount: zero,
    refundCogsReversalAmount: zero,
    refundCount: 0n,
    refundedDiscountAmount: zero,
    refundedOutputVatAmount: zero,
    refundedRegisteredTaxableAmount: null,
    refundedSaleCount: 0n,
    registeredTaxableSalesAmount: null,
    saleCogsAmount: zero,
    saleCount: 0n,
    salesAfterDiscountAmount: zero,
    unknownRefundCostLineCount: 0n,
    unknownSaleCostLineCount: 0n,
  };
}
