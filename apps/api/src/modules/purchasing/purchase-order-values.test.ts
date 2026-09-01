import { Prisma } from "../../generated/prisma/client.ts";
import { describe, expect, it } from "vitest";

import {
  canonicalPurchaseOrderQuantity,
  expectedPurchaseOrderTotal,
  parseExpectedUnitCost,
  parsePurchaseOrderQuantity,
} from "./purchase-order-values.ts";

describe("purchase-order values", () => {
  it("accepts exact positive quantities for their product unit", () => {
    expect(parsePurchaseOrderQuantity("2.5000", "KG")?.toString()).toBe("2.5");
    expect(parsePurchaseOrderQuantity("2.0000", "EA")?.toString()).toBe("2");

    for (const [quantity, unit] of [
      ["0", "KG"],
      ["-1", "KG"],
      ["1.00001", "KG"],
      ["1.5", "EA"],
      ["100000000000000", "KG"],
    ] as const) {
      expect(parsePurchaseOrderQuantity(quantity, unit)).toBeNull();
    }
  });

  it("accepts lossless expected costs and calculates a four-place total", () => {
    expect(parseExpectedUnitCost("0")?.toString()).toBe("0");
    expect(parseExpectedUnitCost("999999999999999.9999")?.toString()).toBe(
      "999999999999999.9999",
    );
    expect(parseExpectedUnitCost("1.00001")).toBeNull();

    expect(
      expectedPurchaseOrderTotal([
        {
          expectedUnitCost: new Prisma.Decimal("10.1234"),
          quantity: new Prisma.Decimal("2.5"),
        },
        {
          expectedUnitCost: new Prisma.Decimal("0.3333"),
          quantity: new Prisma.Decimal("1"),
        },
      ]).toFixed(4),
    ).toBe("25.6418");
  });

  it("uses canonical quantity strings without changing the stored value", () => {
    expect(canonicalPurchaseOrderQuantity(new Prisma.Decimal("4.5000"))).toBe(
      "4.5",
    );
    expect(canonicalPurchaseOrderQuantity(new Prisma.Decimal("4.0000"))).toBe(
      "4",
    );
  });
});
