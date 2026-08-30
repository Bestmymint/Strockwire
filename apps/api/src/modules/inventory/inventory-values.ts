import { Prisma } from "../../generated/prisma/client.ts";

import type { SafeInventoryProduct } from "./inventory-repository.ts";

const DELTA_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,4}))?$/;
const INTEGER_UNITS = new Set<SafeInventoryProduct["unit"]>([
  "EA",
  "PACK",
  "BOX",
]);
const MAXIMUM_INTEGER_DIGITS = 14;

export function canonicalQuantity(value: Prisma.Decimal): string {
  return value
    .toFixed(4)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

export function canonicalizeAdjustmentNote(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const note = value.trim();
  return note.length === 0 ? null : note;
}

export function parseInventoryDelta(
  value: string,
  unit: SafeInventoryProduct["unit"],
): Prisma.Decimal | null {
  const match = DELTA_PATTERN.exec(value);
  if (match === null) return null;

  const integerDigits = (match[2] ?? "").replace(/^0+/, "") || "0";
  const fractionalDigits = match[3] ?? "";
  if (
    integerDigits.length > MAXIMUM_INTEGER_DIGITS ||
    (INTEGER_UNITS.has(unit) && /[1-9]/.test(fractionalDigits))
  ) {
    return null;
  }

  const delta = new Prisma.Decimal(value);
  return delta.isZero() ? null : delta;
}

export function inventoryQuantityFitsStorage(value: Prisma.Decimal): boolean {
  const [integerDigits = ""] = value.abs().toFixed().split(".");
  return (integerDigits.replace(/^0+/, "") || "0").length <= 14;
}
