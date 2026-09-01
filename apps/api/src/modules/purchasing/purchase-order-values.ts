import { Prisma } from "../../generated/prisma/client.ts";

export type PurchaseOrderUnit =
  "EA" | "PACK" | "BOX" | "KG" | "G" | "L" | "ML" | "M" | "CM";

const QUANTITY_PATTERN = /^(\d+)(?:\.(\d{1,4}))?$/;
const COST_PATTERN = /^(\d+)(?:\.(\d{1,4}))?$/;
const INTEGER_UNITS = new Set<PurchaseOrderUnit>(["EA", "PACK", "BOX"]);

function significantIntegerDigits(value: string): number {
  return (value.replace(/^0+/, "") || "0").length;
}

export function parsePurchaseOrderQuantity(
  value: string,
  unit: PurchaseOrderUnit,
): Prisma.Decimal | null {
  const match = QUANTITY_PATTERN.exec(value);
  if (match === null) return null;
  const integer = match[1] ?? "";
  const fractional = match[2] ?? "";
  if (
    significantIntegerDigits(integer) > 14 ||
    (INTEGER_UNITS.has(unit) && /[1-9]/.test(fractional))
  ) {
    return null;
  }
  const quantity = new Prisma.Decimal(value);
  return quantity.greaterThan(0) ? quantity : null;
}

export function parseExpectedUnitCost(value: string): Prisma.Decimal | null {
  const match = COST_PATTERN.exec(value);
  if (match === null || significantIntegerDigits(match[1] ?? "") > 15) {
    return null;
  }
  return new Prisma.Decimal(value);
}

export function expectedPurchaseOrderTotal(
  lines: readonly {
    expectedUnitCost: Prisma.Decimal;
    quantity: Prisma.Decimal;
  }[],
): Prisma.Decimal {
  return lines
    .reduce(
      (total, line) => total.plus(line.quantity.mul(line.expectedUnitCost)),
      new Prisma.Decimal(0),
    )
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function canonicalPurchaseOrderQuantity(value: Prisma.Decimal): string {
  return value
    .toFixed(4)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}
