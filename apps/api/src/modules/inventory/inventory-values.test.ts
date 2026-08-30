import { Prisma } from "../../generated/prisma/client.ts";
import { describe, expect, it } from "vitest";

import {
  canonicalQuantity,
  canonicalizeAdjustmentNote,
  inventoryQuantityFitsStorage,
  parseInventoryDelta,
} from "./inventory-values.ts";

describe("inventory adjustment values", () => {
  it.each([
    ["3.0000", "3"],
    ["2.5000", "2.5"],
    ["-2.2500", "-2.25"],
    ["0.1250", "0.125"],
  ])("canonicalizes %s as %s", (input, expected) => {
    expect(canonicalQuantity(new Prisma.Decimal(input))).toBe(expected);
  });

  it.each(["EA", "PACK", "BOX"] as const)(
    "requires integral %s deltas",
    (unit) => {
      expect(parseInventoryDelta("+3.0000", unit)?.toString()).toBe("3");
      expect(parseInventoryDelta("-1", unit)?.toString()).toBe("-1");
      expect(parseInventoryDelta("1.0001", unit)).toBeNull();
    },
  );

  it.each(["KG", "G", "L", "ML", "M", "CM"] as const)(
    "accepts exact four-place %s deltas",
    (unit) => {
      expect(parseInventoryDelta("+0.1234", unit)?.toString()).toBe("0.1234");
      expect(parseInventoryDelta("-0.1250", unit)?.toString()).toBe("-0.125");
      expect(parseInventoryDelta("0", unit)).toBeNull();
      expect(parseInventoryDelta("-0.0000", unit)).toBeNull();
      expect(parseInventoryDelta("0.12345", unit)).toBeNull();
      expect(parseInventoryDelta("1e2", unit)).toBeNull();
    },
  );

  it("canonicalizes optional notes without normalizing internal text", () => {
    expect(canonicalizeAdjustmentNote(undefined)).toBeNull();
    expect(canonicalizeAdjustmentNote("   ")).toBeNull();
    expect(canonicalizeAdjustmentNote("  นับ  สต็อก  ")).toBe("นับ  สต็อก");
  });

  it("detects DECIMAL(18,4) result overflow before persistence", () => {
    expect(
      inventoryQuantityFitsStorage(new Prisma.Decimal("99999999999999.9999")),
    ).toBe(true);
    expect(
      inventoryQuantityFitsStorage(new Prisma.Decimal("100000000000000")),
    ).toBe(false);
  });
});
