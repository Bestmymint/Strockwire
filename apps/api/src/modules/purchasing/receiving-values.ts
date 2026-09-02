import { createHash } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.ts";

const DECIMAL_19_4_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;
const DECIMAL_9_6_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface InputVatSnapshotInput {
  inputVatAmount: string | null;
  inputVatRate: string | null;
  organizationVatRegistered: boolean;
  supplierTaxDocumentDate: string | null;
  supplierTaxDocumentNumber: string | null;
}

export interface CanonicalInputVatSnapshot {
  inputVatAmount: string | null;
  inputVatRate: string | null;
  organizationVatRegistered: boolean;
  supplierTaxDocumentDate: string | null;
  supplierTaxDocumentNumber: string | null;
}

export function parseActualUnitCost(value: string): Prisma.Decimal | null {
  if (!DECIMAL_19_4_PATTERN.test(value)) return null;
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function canonicalDecimal(value: string, pattern: RegExp): string | null {
  if (!pattern.test(value)) return null;
  try {
    return new Prisma.Decimal(value).toString();
  } catch {
    return null;
  }
}

function validDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function canonicalInputVatSnapshot(
  input: InputVatSnapshotInput,
): CanonicalInputVatSnapshot | null {
  if (typeof input.organizationVatRegistered !== "boolean") return null;
  const rate =
    input.inputVatRate === null
      ? null
      : canonicalDecimal(input.inputVatRate, DECIMAL_9_6_PATTERN);
  const amount =
    input.inputVatAmount === null
      ? null
      : canonicalDecimal(input.inputVatAmount, DECIMAL_19_4_PATTERN);
  if (
    (input.inputVatRate !== null && rate === null) ||
    (input.inputVatAmount !== null && amount === null) ||
    (rate === null) !== (amount === null) ||
    (!input.organizationVatRegistered && rate !== null)
  ) {
    return null;
  }
  const documentNumber = input.supplierTaxDocumentNumber?.trim() ?? null;
  if (
    documentNumber !== null &&
    (documentNumber.length === 0 || documentNumber.length > 100)
  ) {
    return null;
  }
  if (
    input.supplierTaxDocumentDate !== null &&
    !validDateOnly(input.supplierTaxDocumentDate)
  ) {
    return null;
  }
  return {
    inputVatAmount: amount,
    inputVatRate: rate,
    organizationVatRegistered: input.organizationVatRegistered,
    supplierTaxDocumentDate: input.supplierTaxDocumentDate,
    supplierTaxDocumentNumber: documentNumber,
  };
}

export function receivingIdempotencyKeyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function receivingCanonicalRequestHash(input: {
  actualCosts: readonly {
    actualUnitCost: string;
    purchaseOrderItemId: string;
  }[];
  purchaseOrderId: string;
  vat: CanonicalInputVatSnapshot;
}): string {
  const costs = [...input.actualCosts].sort((left, right) =>
    left.purchaseOrderItemId.localeCompare(right.purchaseOrderItemId),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        actualCosts: costs,
        operation: "PURCHASE_RECEIVE",
        purchaseOrderId: input.purchaseOrderId,
        vat: input.vat,
      }),
      "utf8",
    )
    .digest("hex");
}
