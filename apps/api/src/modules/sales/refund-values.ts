import { createHash } from "node:crypto";

import { Prisma } from "../../generated/prisma/client.ts";

const ExactDecimal = Prisma.Decimal.clone({ precision: 80 });
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;
const ZERO = new ExactDecimal(0);

export interface RefundLineIntentInput {
  quantity: string;
  restockQuantity: string;
  saleItemId: string;
}

export interface RefundIntentInput {
  items: readonly RefundLineIntentInput[];
  reason: string;
  transferReference?: string | null;
}

export interface CanonicalRefundLine {
  quantity: Prisma.Decimal;
  restockQuantity: Prisma.Decimal;
  saleItemId: string;
}

export interface CanonicalRefundIntent {
  items: CanonicalRefundLine[];
  reason: string;
  transferReference: string | null;
}

export type CanonicalRefundIntentResult =
  | { intent: CanonicalRefundIntent; kind: "valid" }
  | {
      kind:
        | "duplicate_item"
        | "invalid_quantity"
        | "invalid_reason"
        | "invalid_restock"
        | "invalid_transfer_reference";
    };

function exactDecimal(value: string | Prisma.Decimal): Prisma.Decimal {
  return new ExactDecimal(value);
}

function parseQuantity(value: string): Prisma.Decimal | null {
  if (typeof value !== "string") return null;
  const match = DECIMAL_PATTERN.exec(value);
  if (match === null) return null;
  const integerDigits = (match[1] ?? "").replace(/^0+/, "") || "0";
  if (integerDigits.length > 14 || (match[2]?.length ?? 0) > 4) return null;
  try {
    return exactDecimal(value);
  } catch {
    return null;
  }
}

function trimmedBounded(value: string, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= maximum ? trimmed : null;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validRefundIdempotencyKey(value: string): boolean {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function canonicalizeRefundIntent(
  input: RefundIntentInput,
): CanonicalRefundIntentResult {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { kind: "invalid_quantity" };
  }
  const seen = new Set<string>();
  const items: CanonicalRefundLine[] = [];
  for (const inputItem of input.items) {
    const saleItemId =
      typeof inputItem.saleItemId === "string"
        ? inputItem.saleItemId.toLowerCase()
        : "";
    if (saleItemId === "" || seen.has(saleItemId)) {
      return { kind: "duplicate_item" };
    }
    seen.add(saleItemId);
    const quantity = parseQuantity(inputItem.quantity);
    if (quantity === null || !quantity.greaterThan(0)) {
      return { kind: "invalid_quantity" };
    }
    const restockQuantity = parseQuantity(inputItem.restockQuantity);
    if (
      restockQuantity === null ||
      restockQuantity.isNegative() ||
      restockQuantity.greaterThan(quantity)
    ) {
      return { kind: "invalid_restock" };
    }
    items.push({ quantity, restockQuantity, saleItemId });
  }
  items.sort((left, right) => compareIds(left.saleItemId, right.saleItemId));

  const reason = trimmedBounded(input.reason, 200);
  if (reason === null) return { kind: "invalid_reason" };
  let transferReference: string | null = null;
  if (
    input.transferReference !== null &&
    input.transferReference !== undefined
  ) {
    transferReference = trimmedBounded(input.transferReference, 100);
    if (transferReference === null) {
      return { kind: "invalid_transfer_reference" };
    }
  }
  return {
    intent: { items, reason, transferReference },
    kind: "valid",
  };
}

export function refundIdempotencyKeyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function refundCanonicalRequestHash(input: {
  actorUserId: string;
  branchId: string;
  intent: CanonicalRefundIntent;
  organizationId: string;
  paymentMethod: "CASH" | "TRANSFER";
  saleId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorUserId: input.actorUserId.toLowerCase(),
        branchId: input.branchId.toLowerCase(),
        items: input.intent.items.map((item) => ({
          quantity: item.quantity.toString(),
          restockQuantity: item.restockQuantity.toString(),
          saleItemId: item.saleItemId,
        })),
        operation: "SALE_REFUND",
        organizationId: input.organizationId.toLowerCase(),
        paymentMethod: input.paymentMethod,
        reason: input.intent.reason,
        saleId: input.saleId.toLowerCase(),
        transferReference: input.intent.transferReference,
      }),
      "utf8",
    )
    .digest("hex");
}

function cumulativeTarget(
  originalAmount: Prisma.Decimal,
  cumulativeQuantity: Prisma.Decimal,
  originalQuantity: Prisma.Decimal,
  scale: number,
): Prisma.Decimal {
  if (cumulativeQuantity.equals(originalQuantity)) {
    return exactDecimal(originalAmount);
  }
  return exactDecimal(originalAmount)
    .times(cumulativeQuantity)
    .dividedBy(originalQuantity)
    .toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

export interface RefundLineAmounts {
  cogsReversalAmount: Prisma.Decimal | null;
  reversedLineDiscount: Prisma.Decimal;
  reversedLineGross: Prisma.Decimal;
  reversedLineNet: Prisma.Decimal;
  reversedLineOutputVat: Prisma.Decimal;
  reversedLineTaxable: Prisma.Decimal | null;
}

export function calculateRefundLineAmounts(input: {
  cumulativeQuantity: Prisma.Decimal;
  cumulativeRestockQuantity: Prisma.Decimal;
  originalCogsAmount: Prisma.Decimal | null;
  originalLineDiscount: Prisma.Decimal;
  originalLineNet: Prisma.Decimal;
  originalLineOutputVat: Prisma.Decimal;
  originalQuantity: Prisma.Decimal;
  priorCogsReversal: Prisma.Decimal | null;
  priorLineDiscount: Prisma.Decimal;
  priorLineNet: Prisma.Decimal;
  priorLineOutputVat: Prisma.Decimal;
  salesVatStatus: "NOT_REGISTERED" | "REGISTERED";
}): RefundLineAmounts {
  const targetNet = cumulativeTarget(
    input.originalLineNet,
    input.cumulativeQuantity,
    input.originalQuantity,
    2,
  );
  const targetDiscount = cumulativeTarget(
    input.originalLineDiscount,
    input.cumulativeQuantity,
    input.originalQuantity,
    2,
  );
  const reversedLineNet = targetNet.minus(input.priorLineNet);
  const reversedLineDiscount = targetDiscount.minus(input.priorLineDiscount);
  const reversedLineGross = reversedLineNet.plus(reversedLineDiscount);

  let reversedLineOutputVat = ZERO;
  let reversedLineTaxable: Prisma.Decimal | null = null;
  if (input.salesVatStatus === "REGISTERED") {
    const targetVat = Prisma.Decimal.min(
      cumulativeTarget(
        input.originalLineOutputVat,
        input.cumulativeQuantity,
        input.originalQuantity,
        2,
      ),
      targetNet,
    );
    reversedLineOutputVat = targetVat.minus(input.priorLineOutputVat);
    reversedLineTaxable = reversedLineNet.minus(reversedLineOutputVat);
  }

  let cogsReversalAmount: Prisma.Decimal | null = null;
  if (input.originalCogsAmount !== null) {
    const targetCogs = cumulativeTarget(
      input.originalCogsAmount,
      input.cumulativeRestockQuantity,
      input.originalQuantity,
      10,
    );
    cogsReversalAmount = targetCogs.minus(input.priorCogsReversal ?? ZERO);
  }
  return {
    cogsReversalAmount,
    reversedLineDiscount,
    reversedLineGross,
    reversedLineNet,
    reversedLineOutputVat,
    reversedLineTaxable,
  };
}

export function exactRefundDecimal(
  value: string | Prisma.Decimal,
): Prisma.Decimal {
  return exactDecimal(value);
}
