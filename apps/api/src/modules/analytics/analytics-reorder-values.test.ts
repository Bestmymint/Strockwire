import { describe, expect, it } from "vitest";
import { Prisma, type ProductUnit } from "../../generated/prisma/client.ts";
import {
  buildForecast,
  createForecastWindow,
  type ForecastResult,
} from "./analytics-forecast-values.ts";
import { buildReorder } from "./analytics-reorder-values.ts";

const cutoff = new Date("2026-09-25T05:00:00Z");
const window = createForecastWindow(cutoff, "Asia/Bangkok");
const decimal = (value: string) => new Prisma.Decimal(value);

function forecast(
  unit: ProductUnit = "EA",
  status: "ACTIVE" | "INACTIVE" = "ACTIVE",
) {
  return buildForecast({
    organizationId: "org",
    branchId: "branch",
    productId: "product",
    unit,
    productStatus: status,
    generatedAt: cutoff,
    sourceCutoff: cutoff,
    historyStartAt: new Date(window.trainingStartInclusive),
    window,
    training: Array.from({ length: 28 }, () => decimal("1")),
  });
}

function stock(
  onHand: string,
  ledgerQuantity = onHand,
  invalidSourceCount = 0n,
) {
  return {
    onHand: decimal(onHand),
    ledgerQuantity: decimal(ledgerQuantity),
    invalidSourceCount,
  };
}

describe("Reorder V1 values", () => {
  it.each([
    [undefined, "LEAD_TIME_REQUIRED"],
    [0, "UNSUPPORTED_LEAD_TIME"],
    [-1, "UNSUPPORTED_LEAD_TIME"],
    [1.5, "UNSUPPORTED_LEAD_TIME"],
    [8, "UNSUPPORTED_LEAD_TIME"],
  ] as const)("rejects lead time %s", (leadTimeDays, reason) => {
    const result = buildReorder({
      forecast: forecast(),
      ...(leadTimeDays === undefined ? {} : { leadTimeDays }),
    });
    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      reason,
      leadTimeDemand: null,
      rawNeed: null,
      recommendedQuantity: null,
    });
    expect(result.dailyForecast).toHaveLength(7);
  });

  it("accepts one and seven days and sums serialized daily values", () => {
    const base = forecast();
    if (base.status !== "AVAILABLE") throw new Error("fixture");
    const rounded: ForecastResult = {
      ...base,
      days: base.days.map((day) => ({ ...day, quantity: "0.1071" })),
    };
    const one = buildReorder({
      forecast: rounded,
      leadTimeDays: 1,
      stock: stock("0"),
    });
    const seven = buildReorder({
      forecast: rounded,
      leadTimeDays: 7,
      stock: stock("0"),
    });
    expect(one).toMatchObject({
      status: "AVAILABLE",
      leadTimeDemand: "0.1071",
      recommendedQuantity: "1.0000",
    });
    expect(seven).toMatchObject({
      status: "AVAILABLE",
      leadTimeDemand: "0.7497",
      rawNeed: "0.7497",
    });
    expect(seven.sourceCutoff).toBe(cutoff.toISOString());
    expect(seven.dailyForecast?.[0]?.localDate).toBe("2026-09-26");
  });

  it.each([
    ["2", "0.0000"],
    ["1", "0.0000"],
    ["0.9999", "0.0001"],
    ["0", "1.0000"],
  ])("floors demand minus %s on hand", (onHand, rawNeed) => {
    expect(
      buildReorder({
        forecast: forecast("KG"),
        leadTimeDays: 1,
        stock: stock(onHand),
      }),
    ).toMatchObject({
      status: "AVAILABLE",
      rawNeed,
      recommendedQuantity: rawNeed,
    });
  });

  it.each(["EA", "PACK", "BOX"] as const)(
    "ceilings %s and checks the boundary",
    (unit) => {
      const base = forecast(unit);
      if (base.status !== "AVAILABLE") throw new Error("fixture");
      for (const [quantity, expected] of [
        ["0.0000", "0.0000"],
        ["0.0001", "1.0000"],
        ["1.0000", "1.0000"],
        ["1.0001", "2.0000"],
      ] as const) {
        const result = buildReorder({
          forecast: {
            ...base,
            days: base.days.map((day) => ({ ...day, quantity })),
          },
          leadTimeDays: 1,
          stock: stock("0"),
        });
        expect(result.recommendedQuantity).toBe(expected);
      }
    },
  );

  it.each(["KG", "G", "L", "ML", "M", "CM"] as const)(
    "preserves four-place %s",
    (unit) => {
      const base = forecast(unit);
      if (base.status !== "AVAILABLE") throw new Error("fixture");
      const result = buildReorder({
        forecast: {
          ...base,
          days: base.days.map((day) => ({ ...day, quantity: "1.0001" })),
        },
        leadTimeDays: 1,
        stock: stock("0"),
      });
      expect(result).toMatchObject({
        rawNeed: "1.0001",
        recommendedQuantity: "1.0001",
      });
    },
  );

  it("rejects raw and post-ceiling overflow", () => {
    const base = forecast();
    if (base.status !== "AVAILABLE") throw new Error("fixture");
    for (const quantity of ["100000000000000.0000", "99999999999999.0001"]) {
      const result = buildReorder({
        forecast: {
          ...base,
          days: base.days.map((day) => ({ ...day, quantity })),
        },
        leadTimeDays: 1,
        stock: stock("0"),
      });
      expect(result).toMatchObject({
        status: "UNAVAILABLE",
        reason: "QUANTITY_OUT_OF_RANGE",
        rawNeed: null,
        recommendedQuantity: null,
      });
      expect(result.dailyForecast).toHaveLength(7);
    }
  });

  it("keeps forecast reason precedence and leaves derived guidance null", () => {
    const inactive = buildReorder({
      forecast: forecast("EA", "INACTIVE"),
      leadTimeDays: 0,
    });
    const insufficient = buildForecast({
      organizationId: "org",
      branchId: "branch",
      productId: "product",
      unit: "EA",
      productStatus: "ACTIVE",
      generatedAt: cutoff,
      sourceCutoff: cutoff,
      historyStartAt: null,
      window,
      training: Array.from({ length: 28 }, () => decimal("0")),
    });
    expect(inactive).toMatchObject({
      status: "UNAVAILABLE",
      reason: "INACTIVE_PRODUCT",
      dailyForecast: null,
      onHand: null,
    });
    expect(
      buildReorder({ forecast: insufficient, leadTimeDays: 0 }),
    ).toMatchObject({
      status: "UNAVAILABLE",
      reason: "INSUFFICIENT_DATA",
      leadTimeDemand: null,
    });
    expect(
      buildReorder({
        forecast: forecast(),
        leadTimeDays: 1,
        stock: stock("-1"),
      }),
    ).toMatchObject({
      status: "UNAVAILABLE",
      reason: "INVENTORY_INTEGRITY_ERROR",
      onHand: null,
    });
    expect(
      buildReorder({
        forecast: forecast(),
        leadTimeDays: 0,
        stock: stock("-1"),
      }),
    ).toMatchObject({ status: "UNAVAILABLE", reason: "UNSUPPORTED_LEAD_TIME" });
  });

  it("accepts an available zero forecast and versioned output", () => {
    const base = forecast();
    if (base.status !== "AVAILABLE") throw new Error("fixture");
    expect(
      buildReorder({
        forecast: {
          ...base,
          days: base.days.map((day) => ({ ...day, quantity: "0.0000" })),
        },
        leadTimeDays: 1,
        stock: stock("0"),
      }),
    ).toMatchObject({
      status: "AVAILABLE",
      reason: null,
      rawNeed: "0.0000",
      recommendedQuantity: "0.0000",
      reorderVersion: "reorder-v1",
    });
  });

  it.each([stock("1", "0"), stock("1", "1", 1n), stock("1.5", "1.5")])(
    "rejects unreconciled or fractional integer-unit stock",
    (current) => {
      const result = buildReorder({
        forecast: forecast(),
        leadTimeDays: 1,
        stock: current,
      });
      expect(result).toMatchObject({
        status: "UNAVAILABLE",
        reason: "INVENTORY_INTEGRITY_ERROR",
        onHand: null,
      });
      expect(result.dailyForecast).toHaveLength(7);
    },
  );
});
