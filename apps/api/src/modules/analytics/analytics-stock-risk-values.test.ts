import { describe, expect, it } from "vitest";

import { classifyInventoryStock } from "./analytics-stock-risk-values.ts";

describe("stock-risk-v1 inventory classification", () => {
  it.each([
    ["0.00", "LOW_STOCK"],
    ["3.25", "LOW_STOCK"],
    ["7.00", "LOW_STOCK"],
    ["7.01", "NORMAL"],
    ["30.00", "NORMAL"],
    ["59.99", "NORMAL"],
    ["60.00", "OVERSTOCK"],
    ["60.01", "OVERSTOCK"],
    ["1000000.00", "OVERSTOCK"],
    ["7.0000000000000000000001", "NORMAL"],
    ["59.9999999999999999999999", "NORMAL"],
  ] as const)("classifies %s as %s using Decimal", (value, classification) => {
    expect(classifyInventoryStock({ value, reason: null }, "ACTIVE")).toEqual({
      classification,
      reason: null,
      thresholdVersion: "stock-risk-v1",
    });
  });

  it.each([
    "INSUFFICIENT_DATA",
    "NO_RECENT_DEMAND",
    "NO_STOCK_AND_NO_DEMAND",
    "INVENTORY_INTEGRITY_ERROR",
  ] as const)("preserves unavailable reason %s", (reason) => {
    expect(classifyInventoryStock({ value: null, reason }, "ACTIVE")).toEqual({
      classification: null,
      reason,
      thresholdVersion: "stock-risk-v1",
    });
  });

  it.each([
    { value: "0.00", reason: null },
    { value: "30.00", reason: null },
    { value: "60.00", reason: null },
    { value: null, reason: "INVENTORY_INTEGRITY_ERROR" },
  ] as const)("gates inactive Products before coverage %o", (coverage) => {
    expect(classifyInventoryStock(coverage, "INACTIVE")).toEqual({
      classification: null,
      reason: "INACTIVE_PRODUCT",
      thresholdVersion: "stock-risk-v1",
    });
  });

  it("rejects inconsistent coverage results rather than assigning a label", () => {
    expect(() =>
      classifyInventoryStock({ value: null, reason: null }, "ACTIVE"),
    ).toThrow("missing an accepted reason");
    expect(() =>
      classifyInventoryStock(
        { value: "7.00", reason: "INSUFFICIENT_DATA" },
        "ACTIVE",
      ),
    ).toThrow("has a value and an unavailable reason");
  });
});
