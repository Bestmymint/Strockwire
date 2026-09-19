import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.ts";
import {
  calculateRefundLineAmounts,
  canonicalizeRefundIntent,
  refundCanonicalRequestHash,
} from "./refund-values.ts";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("refund intent values", () => {
  it("canonicalizes Unicode reason, quantities, item order, and reference", () => {
    const result = canonicalizeRefundIntent({
      items: [
        {
          quantity: "1.0000",
          restockQuantity: "0",
          saleItemId: "B0000000-0000-4000-8000-000000000001",
        },
        {
          quantity: "0.1250",
          restockQuantity: "0.1000",
          saleItemId: "A0000000-0000-4000-8000-000000000001",
        },
      ],
      reason: "  ลูกค้าคืนสินค้า  ",
      transferReference: "  RF-001  ",
    });

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.intent.reason).toBe("ลูกค้าคืนสินค้า");
    expect(result.intent.transferReference).toBe("RF-001");
    expect(result.intent.items.map((item) => item.saleItemId)).toEqual([
      "a0000000-0000-4000-8000-000000000001",
      "b0000000-0000-4000-8000-000000000001",
    ]);
  });

  it.each([
    ["duplicate_item", "1", "0", "1", "0"],
    ["invalid_quantity", "0", "0", "", ""],
    ["invalid_quantity", "1.00001", "0", "", ""],
    ["invalid_restock", "1", "1.0001", "", ""],
  ] as const)(
    "rejects %s",
    (kind, quantity, restockQuantity, second, secondRestock) => {
      const result = canonicalizeRefundIntent({
        items: [
          { quantity, restockQuantity, saleItemId: "item" },
          ...(second === ""
            ? []
            : [
                {
                  quantity: second,
                  restockQuantity: secondRestock,
                  saleItemId: "item",
                },
              ]),
        ],
        reason: "Return",
      });
      expect(result.kind).toBe(kind);
    },
  );

  it("allocates sequential money so the final quantity absorbs the exact remainder", () => {
    const first = calculateRefundLineAmounts({
      cumulativeQuantity: decimal("1"),
      cumulativeRestockQuantity: decimal("0"),
      originalCogsAmount: decimal("30"),
      originalLineDiscount: decimal("10"),
      originalLineNet: decimal("100"),
      originalLineOutputVat: decimal("7"),
      originalQuantity: decimal("3"),
      priorCogsReversal: decimal("0"),
      priorLineDiscount: decimal("0"),
      priorLineNet: decimal("0"),
      priorLineOutputVat: decimal("0"),
      salesVatStatus: "REGISTERED",
    });
    const second = calculateRefundLineAmounts({
      cumulativeQuantity: decimal("2"),
      cumulativeRestockQuantity: decimal("0"),
      originalCogsAmount: decimal("30"),
      originalLineDiscount: decimal("10"),
      originalLineNet: decimal("100"),
      originalLineOutputVat: decimal("7"),
      originalQuantity: decimal("3"),
      priorCogsReversal: decimal("0"),
      priorLineDiscount: first.reversedLineDiscount,
      priorLineNet: first.reversedLineNet,
      priorLineOutputVat: first.reversedLineOutputVat,
      salesVatStatus: "REGISTERED",
    });
    const third = calculateRefundLineAmounts({
      cumulativeQuantity: decimal("3"),
      cumulativeRestockQuantity: decimal("0"),
      originalCogsAmount: decimal("30"),
      originalLineDiscount: decimal("10"),
      originalLineNet: decimal("100"),
      originalLineOutputVat: decimal("7"),
      originalQuantity: decimal("3"),
      priorCogsReversal: decimal("0"),
      priorLineDiscount: first.reversedLineDiscount.plus(
        second.reversedLineDiscount,
      ),
      priorLineNet: first.reversedLineNet.plus(second.reversedLineNet),
      priorLineOutputVat: first.reversedLineOutputVat.plus(
        second.reversedLineOutputVat,
      ),
      salesVatStatus: "REGISTERED",
    });

    expect([
      first.reversedLineNet.toFixed(2),
      second.reversedLineNet.toFixed(2),
      third.reversedLineNet.toFixed(2),
    ]).toEqual(["33.33", "33.34", "33.33"]);
    expect(
      first.reversedLineNet
        .plus(second.reversedLineNet)
        .plus(third.reversedLineNet)
        .toFixed(2),
    ).toBe("100.00");
  });

  it("ties COGS reversal to restock quantity and preserves UNKNOWN as null", () => {
    const known = calculateRefundLineAmounts({
      cumulativeQuantity: decimal("1"),
      cumulativeRestockQuantity: decimal("0.5"),
      originalCogsAmount: decimal("70.2469120000"),
      originalLineDiscount: decimal("0"),
      originalLineNet: decimal("120.25"),
      originalLineOutputVat: decimal("0"),
      originalQuantity: decimal("2"),
      priorCogsReversal: decimal("0"),
      priorLineDiscount: decimal("0"),
      priorLineNet: decimal("0"),
      priorLineOutputVat: decimal("0"),
      salesVatStatus: "NOT_REGISTERED",
    });
    const unknown = calculateRefundLineAmounts({
      cumulativeQuantity: decimal("1"),
      cumulativeRestockQuantity: decimal("1"),
      originalCogsAmount: null,
      originalLineDiscount: decimal("0"),
      originalLineNet: decimal("10"),
      originalLineOutputVat: decimal("0"),
      originalQuantity: decimal("1"),
      priorCogsReversal: null,
      priorLineDiscount: decimal("0"),
      priorLineNet: decimal("0"),
      priorLineOutputVat: decimal("0"),
      salesVatStatus: "NOT_REGISTERED",
    });

    expect(known.cogsReversalAmount?.toFixed(10)).toBe("17.5617280000");
    expect(unknown.cogsReversalAmount).toBeNull();
  });

  it("binds canonical idempotency intent to actor, scope, payment, and item meaning", () => {
    const canonical = canonicalizeRefundIntent({
      items: [{ quantity: "1", restockQuantity: "0", saleItemId: "item" }],
      reason: "Return",
    });
    expect(canonical.kind).toBe("valid");
    if (canonical.kind !== "valid") return;
    const base = {
      actorUserId: "actor",
      branchId: "branch",
      intent: canonical.intent,
      organizationId: "organization",
      paymentMethod: "CASH" as const,
      saleId: "sale",
    };
    expect(refundCanonicalRequestHash(base)).not.toBe(
      refundCanonicalRequestHash({ ...base, actorUserId: "other" }),
    );
  });
});
