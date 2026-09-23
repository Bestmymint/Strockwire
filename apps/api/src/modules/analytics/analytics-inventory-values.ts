import { Temporal } from "@js-temporal/polyfill";

import { Prisma } from "../../generated/prisma/client.ts";
import type {
  AnalyticsPeriodBucket,
  AnalyticsPeriodContext,
} from "./analytics-period.ts";
import { localDateToUtcBoundary } from "./analytics-period.ts";

const Decimal = Prisma.Decimal.clone({ precision: 80 });
const ZERO = new Decimal(0);

export type InventoryMetricReason =
  | "INCOMPLETE_PERIOD"
  | "INSUFFICIENT_DATA"
  | "NO_RECENT_DEMAND"
  | "NO_STOCK_AND_NO_DEMAND"
  | "INVENTORY_INTEGRITY_ERROR"
  | "INCOMPLETE_COST_COVERAGE";

export interface InventoryNullableMetric {
  value: string | null;
  reason: InventoryMetricReason | null;
}

export interface InventoryMovementBucket extends Pick<
  AnalyticsPeriodBucket,
  | "bucketStartInclusive"
  | "bucketEndExclusive"
  | "localStartInclusive"
  | "localEndExclusive"
  | "label"
  | "dataStatus"
> {
  purchaseReceivedQuantity: string;
  saleDepletionQuantity: string;
  refundReturnQuantity: string;
  positiveAdjustmentQuantity: string;
  negativeAdjustmentQuantity: string;
}

export interface InventoryCostResult {
  inventoryValue: InventoryNullableMetric;
  knownInventoryValue: string;
  knownCostProductCount: number;
  unknownCostProductCount: number;
  unknownQuantityByUnit: Readonly<Record<string, string>>;
}

export interface InventoryDimension {
  branchId: string;
  branchName: string;
  branchStatus: "ACTIVE" | "INACTIVE";
  productId: string;
  productName: string;
  productStatus: "ACTIVE" | "INACTIVE";
  productUnit: string;
  buckets: readonly InventoryMovementBucket[];
  requestedPeriodAds: InventoryNullableMetric;
  coverageSalesVelocity: InventoryNullableMetric;
  onHandQuantity: string;
  coverageDays: InventoryNullableMetric;
  cost?: InventoryCostResult;
}

export interface InventoryAggregateRow {
  branchId: string;
  branchName: string;
  branchStatus: "ACTIVE" | "INACTIVE";
  productId: string;
  productName: string;
  productStatus: "ACTIVE" | "INACTIVE";
  productUnit: string;
  bucketIndex: number;
  purchaseReceived: Prisma.Decimal;
  saleDepletion: Prisma.Decimal;
  refundReturn: Prisma.Decimal;
  positiveAdjustment: Prisma.Decimal;
  negativeAdjustment: Prisma.Decimal;
  periodSaleDepletion: Prisma.Decimal;
  coverageSaleDepletion: Prisma.Decimal;
  firstMovementAt: Date | null;
  onHand: Prisma.Decimal;
  ledgerQuantity: Prisma.Decimal;
  invalidSourceCount: bigint;
  costBasisState: "KNOWN" | "UNKNOWN" | null;
  costInventoryValue: Prisma.Decimal | null;
  costAverageUnitCost: Prisma.Decimal | null;
}

function quantity(value: Prisma.Decimal): string {
  return new Decimal(value).toFixed(4);
}

function nullable(
  value: string | null,
  reason: InventoryMetricReason,
): InventoryNullableMetric {
  return value === null ? { value: null, reason } : { value, reason: null };
}

export function coverageWindow(period: AnalyticsPeriodContext): {
  start: Date;
  end: Date;
} {
  const localDay = Temporal.Instant.fromEpochMilliseconds(
    period.sourceCutoff.getTime(),
  )
    .toZonedDateTimeISO(period.reportingTimezone)
    .toPlainDate();
  return {
    start: localDateToUtcBoundary(
      localDay.subtract({ days: 28 }).toString(),
      period.reportingTimezone,
    ),
    end: localDateToUtcBoundary(localDay.toString(), period.reportingTimezone),
  };
}

export function buildInventoryDimension(input: {
  rows: readonly InventoryAggregateRow[];
  period: AnalyticsPeriodContext;
  canViewCost: boolean;
}): InventoryDimension {
  const first = input.rows[0];
  if (
    first === undefined ||
    input.rows.length !== input.period.buckets.length
  ) {
    throw new Error(
      "Inventory dimension must have one row per canonical bucket.",
    );
  }
  const onHand = new Decimal(first.onHand);
  const ledger = new Decimal(first.ledgerQuantity);
  const integralUnit = ["EA", "PACK", "BOX"].includes(first.productUnit);
  const integrityError =
    onHand.isNegative() ||
    !onHand.eq(ledger) ||
    first.invalidSourceCount > 0n ||
    (integralUnit && !onHand.isInteger());
  const window = coverageWindow(input.period);
  const eligible =
    first.firstMovementAt !== null && first.firstMovementAt <= window.start;
  const velocityExact = eligible
    ? new Decimal(first.coverageSaleDepletion).dividedBy(28)
    : null;
  const coverageSalesVelocity = nullable(
    velocityExact
      ?.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(4) ?? null,
    "INSUFFICIENT_DATA",
  );
  const completeDays = Temporal.PlainDate.from(input.period.from).until(
    Temporal.PlainDate.from(input.period.to),
    { largestUnit: "day" },
  ).days;
  const requestedPeriodAds = nullable(
    input.period.dataStatus === "complete"
      ? new Decimal(first.periodSaleDepletion)
          .dividedBy(completeDays)
          .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(4)
      : null,
    "INCOMPLETE_PERIOD",
  );
  let coverageDays: InventoryNullableMetric;
  if (integrityError)
    coverageDays = nullable(null, "INVENTORY_INTEGRITY_ERROR");
  else if (velocityExact === null)
    coverageDays = nullable(null, "INSUFFICIENT_DATA");
  else if (velocityExact.isZero())
    coverageDays = nullable(
      null,
      onHand.isZero() ? "NO_STOCK_AND_NO_DEMAND" : "NO_RECENT_DEMAND",
    );
  else
    coverageDays = nullable(
      onHand
        .dividedBy(velocityExact)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(2),
      "INSUFFICIENT_DATA",
    );

  const buckets = input.rows.map((row, index): InventoryMovementBucket => {
    if (row.bucketIndex !== index)
      throw new Error("Inventory bucket ordering mismatch.");
    return {
      ...input.period.buckets[index]!,
      purchaseReceivedQuantity: quantity(row.purchaseReceived),
      saleDepletionQuantity: quantity(row.saleDepletion),
      refundReturnQuantity: quantity(row.refundReturn),
      positiveAdjustmentQuantity: quantity(row.positiveAdjustment),
      negativeAdjustmentQuantity: quantity(row.negativeAdjustment),
    };
  });
  const result: InventoryDimension = {
    branchId: first.branchId,
    branchName: first.branchName,
    branchStatus: first.branchStatus,
    productId: first.productId,
    productName: first.productName,
    productStatus: first.productStatus,
    productUnit: first.productUnit,
    buckets,
    requestedPeriodAds,
    coverageSalesVelocity,
    onHandQuantity: quantity(first.onHand),
    coverageDays,
  };
  if (input.canViewCost) {
    const known = first.costBasisState === "KNOWN";
    const malformed = known
      ? first.costInventoryValue === null ||
        first.costAverageUnitCost === null ||
        new Decimal(first.costInventoryValue).isNegative() ||
        new Decimal(first.costAverageUnitCost).isNegative() ||
        (onHand.isZero() && !new Decimal(first.costInventoryValue).isZero())
      : first.costBasisState === "UNKNOWN"
        ? first.costInventoryValue !== null ||
          first.costAverageUnitCost !== null
        : false;
    const positive = onHand.greaterThan(ZERO);
    const knownValue =
      known && !malformed && first.costInventoryValue !== null
        ? new Decimal(first.costInventoryValue).toFixed(10)
        : ZERO.toFixed(10);
    result.cost = {
      inventoryValue:
        malformed || integrityError
          ? nullable(null, "INVENTORY_INTEGRITY_ERROR")
          : positive && !known
            ? nullable(null, "INCOMPLETE_COST_COVERAGE")
            : nullable(
                positive ? knownValue : ZERO.toFixed(10),
                "INCOMPLETE_COST_COVERAGE",
              ),
      knownInventoryValue: knownValue,
      knownCostProductCount: positive && known && !malformed ? 1 : 0,
      unknownCostProductCount: positive && !known ? 1 : 0,
      unknownQuantityByUnit:
        positive && !known
          ? { [first.productUnit]: quantity(first.onHand) }
          : {},
    };
  }
  return result;
}
