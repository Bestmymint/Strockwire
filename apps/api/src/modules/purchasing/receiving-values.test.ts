import { describe, expect, it } from "vitest";

import {
  canonicalInputVatSnapshot,
  parseActualUnitCost,
  receivingCanonicalRequestHash,
  receivingIdempotencyKeyHash,
} from "./receiving-values.ts";

const noVat = {
  inputVatAmount: null,
  inputVatRate: null,
  organizationVatRegistered: false,
  supplierTaxDocumentDate: null,
  supplierTaxDocumentNumber: null,
} as const;

describe("receiving values", () => {
  it("accepts exact nonnegative four-place actual costs without rounding", () => {
    expect(parseActualUnitCost("0")?.toFixed(4)).toBe("0.0000");
    expect(parseActualUnitCost("999999999999999.9999")?.toFixed(4)).toBe(
      "999999999999999.9999",
    );
    expect(parseActualUnitCost("1.23456")).toBeNull();
    expect(parseActualUnitCost("-0.0001")).toBeNull();
    expect(parseActualUnitCost("01.00")).toBeNull();
  });

  it("canonicalizes only the bounded document-level Input VAT snapshot", () => {
    expect(
      canonicalInputVatSnapshot({
        inputVatAmount: "7.0000",
        inputVatRate: "7.000000",
        organizationVatRegistered: true,
        supplierTaxDocumentDate: "2026-09-02",
        supplierTaxDocumentNumber: "  TAX-001  ",
      }),
    ).toEqual({
      inputVatAmount: "7",
      inputVatRate: "7",
      organizationVatRegistered: true,
      supplierTaxDocumentDate: "2026-09-02",
      supplierTaxDocumentNumber: "TAX-001",
    });
    expect(
      canonicalInputVatSnapshot({ ...noVat, inputVatRate: "7" }),
    ).toBeNull();
    expect(
      canonicalInputVatSnapshot({
        ...noVat,
        inputVatAmount: "1",
        inputVatRate: "7",
      }),
    ).toBeNull();
    expect(
      canonicalInputVatSnapshot({
        ...noVat,
        supplierTaxDocumentDate: "2026-02-30",
      }),
    ).toBeNull();
    expect(
      canonicalInputVatSnapshot({
        ...noVat,
        organizationVatRegistered: "true" as never,
      }),
    ).toBeNull();
  });

  it("hashes receipt identity separately and canonicalizes line order", () => {
    expect(receivingIdempotencyKeyHash("receipt-key")).toMatch(
      /^[0-9a-f]{64}$/,
    );
    const first = receivingCanonicalRequestHash({
      actualCosts: [
        { actualUnitCost: "2.0000", purchaseOrderItemId: "b" },
        { actualUnitCost: "1.0000", purchaseOrderItemId: "a" },
      ],
      purchaseOrderId: "po",
      vat: noVat,
    });
    const reordered = receivingCanonicalRequestHash({
      actualCosts: [
        { actualUnitCost: "1.0000", purchaseOrderItemId: "a" },
        { actualUnitCost: "2.0000", purchaseOrderItemId: "b" },
      ],
      purchaseOrderId: "po",
      vat: noVat,
    });
    expect(first).toBe(reordered);
  });
});
