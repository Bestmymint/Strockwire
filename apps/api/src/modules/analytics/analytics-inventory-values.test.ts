import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.ts";
import { createAnalyticsPeriodContext } from "./analytics-period.ts";
import {
  buildInventoryDimension,
  coverageWindow,
  type InventoryAggregateRow,
} from "./analytics-inventory-values.ts";

const period = createAnalyticsPeriodContext({
  from: "2026-09-01",
  to: "2026-09-03",
  granularity: "day",
  reportingTimezone: "Asia/Bangkok",
  sourceCutoff: new Date("2026-09-04T00:00:00.000Z"),
});
const dec = (value: string) => new Prisma.Decimal(value);

function rows(
  changes: Partial<InventoryAggregateRow> = {},
): InventoryAggregateRow[] {
  const base: InventoryAggregateRow = {
    branchId: "branch",
    branchName: "Branch",
    branchStatus: "ACTIVE",
    productId: "product",
    productName: "Product",
    productStatus: "ACTIVE",
    productUnit: "KG",
    bucketIndex: 0,
    purchaseReceived: dec("0"),
    saleDepletion: dec("0"),
    refundReturn: dec("0"),
    positiveAdjustment: dec("0"),
    negativeAdjustment: dec("0"),
    periodSaleDepletion: dec("7"),
    coverageSaleDepletion: dec("28"),
    firstMovementAt: new Date("2026-01-01T00:00:00.000Z"),
    onHand: dec("10.0000"),
    ledgerQuantity: dec("10.0000"),
    invalidSourceCount: 0n,
    costBasisState: "KNOWN",
    costInventoryValue: dec("123.1234567890"),
    costAverageUnitCost: dec("12.312346"),
  };
  return period.buckets.map((_, index) => ({
    ...base,
    ...changes,
    bucketIndex: index,
  }));
}

describe("inventory analytics values", () => {
  it("uses separate ADS and 28-day velocity and persisted ten-place value", () => {
    const result = buildInventoryDimension({
      rows: rows(),
      period,
      canViewCost: true,
    });
    expect(result.requestedPeriodAds).toEqual({
      value: "3.5000",
      reason: null,
    });
    expect(result.coverageSalesVelocity).toEqual({
      value: "1.0000",
      reason: null,
    });
    expect(result.coverageDays).toEqual({ value: "10.00", reason: null });
    expect(result.cost?.inventoryValue.value).toBe("123.1234567890");
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[1]?.saleDepletionQuantity).toBe("0.0000");
  });

  it("distinguishes insufficient history and both zero demand states", () => {
    const start = coverageWindow(period).start;
    expect(
      buildInventoryDimension({
        rows: rows({ firstMovementAt: new Date(start.getTime() + 1) }),
        period,
        canViewCost: false,
      }).coverageDays.reason,
    ).toBe("INSUFFICIENT_DATA");
    expect(
      buildInventoryDimension({
        rows: rows({ firstMovementAt: start, coverageSaleDepletion: dec("0") }),
        period,
        canViewCost: false,
      }).coverageDays.reason,
    ).toBe("NO_RECENT_DEMAND");
    expect(
      buildInventoryDimension({
        rows: rows({
          onHand: dec("0"),
          ledgerQuantity: dec("0"),
          coverageSaleDepletion: dec("0"),
        }),
        period,
        canViewCost: false,
      }).coverageDays.reason,
    ).toBe("NO_STOCK_AND_NO_DEMAND");
  });

  it("rounds fractional coverage days HALF_UP only at the display boundary", () => {
    const result = buildInventoryDimension({
      rows: rows({ onHand: dec("1.0050"), ledgerQuantity: dec("1.0050") }),
      period,
      canViewCost: false,
    });
    expect(result.coverageDays.value).toBe("1.01");
  });

  it("suppresses coverage for divergent balance and cost for unknown positive stock", () => {
    const result = buildInventoryDimension({
      rows: rows({
        ledgerQuantity: dec("9"),
        costBasisState: "UNKNOWN",
        costInventoryValue: null,
        costAverageUnitCost: null,
      }),
      period,
      canViewCost: true,
    });
    expect(result.coverageDays.reason).toBe("INVENTORY_INTEGRITY_ERROR");
    expect(result.cost?.inventoryValue.reason).toBe(
      "INVENTORY_INTEGRITY_ERROR",
    );
    const unknown = buildInventoryDimension({
      rows: rows({
        costBasisState: "UNKNOWN",
        costInventoryValue: null,
        costAverageUnitCost: null,
      }),
      period,
      canViewCost: true,
    });
    expect(unknown.cost?.inventoryValue.reason).toBe(
      "INCOMPLETE_COST_COVERAGE",
    );
  });

  it("keeps negative stock and malformed KNOWN cost as explicit integrity errors", () => {
    const negative = buildInventoryDimension({
      rows: rows({ onHand: dec("-1"), ledgerQuantity: dec("-1") }),
      period,
      canViewCost: true,
    });
    expect(negative.coverageDays).toEqual({
      value: null,
      reason: "INVENTORY_INTEGRITY_ERROR",
    });
    expect(negative.cost?.inventoryValue.reason).toBe(
      "INVENTORY_INTEGRITY_ERROR",
    );
    const malformed = buildInventoryDimension({
      rows: rows({ costBasisState: "KNOWN", costInventoryValue: null }),
      period,
      canViewCost: true,
    });
    expect(malformed.cost?.inventoryValue.reason).toBe(
      "INVENTORY_INTEGRITY_ERROR",
    );
  });

  it("respects incomplete requested periods and DST local-day window", () => {
    const partial = createAnalyticsPeriodContext({
      from: "2026-09-01",
      to: "2026-09-03",
      granularity: "day",
      reportingTimezone: "Asia/Bangkok",
      sourceCutoff: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(
      buildInventoryDimension({
        rows: rows(),
        period: partial,
        canViewCost: false,
      }).requestedPeriodAds.reason,
    ).toBe("INCOMPLETE_PERIOD");
    const dst = createAnalyticsPeriodContext({
      from: "2026-03-09",
      to: "2026-03-10",
      granularity: "day",
      reportingTimezone: "America/New_York",
      sourceCutoff: new Date("2026-03-09T12:00:00.000Z"),
    });
    const window = coverageWindow(dst);
    expect(window.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect((window.end.getTime() - window.start.getTime()) / 3600000).not.toBe(
      28 * 24,
    );
  });
});
