import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import {
  can,
  createTrustedAuthorizationContext,
  createTrustedBranchScope,
  PERMISSIONS,
} from "../identity/authorization-policy.ts";
import {
  inventoryBalanceAdvisoryLockKey,
  inventoryIdempotencyAdvisoryLockKey,
} from "../inventory/inventory-repository.ts";
import {
  canonicalQuantity,
  inventoryQuantityFitsStorage,
} from "../inventory/inventory-values.ts";
import {
  calculateRefundLineAmounts,
  canonicalizeRefundIntent,
  exactRefundDecimal,
  refundCanonicalRequestHash,
  refundIdempotencyKeyHash,
  validRefundIdempotencyKey,
  type RefundIntentInput,
} from "./refund-values.ts";

type Transaction = Prisma.TransactionClient;

export interface CreateRefundInput extends RefundIntentInput {
  actorUserId: string;
  branchId: string;
  idempotencyKey: string;
  organizationId: string;
  saleId: string;
}

export interface SafeSaleRefundItem {
  cogsReversalAmount?: string | null;
  id: string;
  originalCostBasisState?: "KNOWN" | "UNKNOWN";
  originalUnitCost?: string | null;
  productId: string;
  refundQuantity: string;
  restockQuantity: string;
  reversedLineDiscount: string;
  reversedLineGross: string;
  reversedLineNet: string;
  reversedLineOutputVat: string;
  reversedLineTaxable: string | null;
  saleItemId: string;
}

export interface SafeSaleRefund {
  actorDisplayName: string;
  branchId: string;
  completedAt: string;
  currency: "THB";
  discountAmount: string;
  grossAmount: string;
  id: string;
  items: SafeSaleRefundItem[];
  organizationId: string;
  outputVatAmount: string;
  payment: {
    amount: string;
    method: "CASH" | "TRANSFER";
    reference: string | null;
  };
  reason: string;
  reference: string;
  saleId: string;
  salesVatRate: string | null;
  salesVatStatus: "NOT_REGISTERED" | "REGISTERED";
  taxableAmount: string | null;
  totalAmount: string;
}

export type RefundOutcome =
  | { kind: "success"; refund: SafeSaleRefund }
  | { kind: "replay"; refund: SafeSaleRefund }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "branch_inactive" }
  | { kind: "sale_already_fully_refunded" }
  | { kind: "refund_quantity_exceeded" }
  | { kind: "duplicate_item" }
  | { kind: "invalid_idempotency_key" }
  | { kind: "invalid_quantity" }
  | { kind: "invalid_reason" }
  | { kind: "invalid_restock" }
  | { kind: "invalid_transfer_reference" }
  | { kind: "invalid_payment_method" }
  | { kind: "zero_refund_amount" }
  | { kind: "idempotency_conflict" };

export interface RefundRepository {
  createRefund(input: CreateRefundInput): Promise<RefundOutcome>;
}

export interface RefundRepositoryOptions {
  afterLineCommitted?: (lineIndex: number) => Promise<void> | void;
  afterProductLocksAcquired?: () => Promise<void> | void;
  afterStage?: (
    stage:
      | "refund_created"
      | "refund_item_created"
      | "inventory_balance_updated"
      | "inventory_cost_updated"
      | "inventory_ledger_created"
      | "payment_created",
    lineIndex?: number,
  ) => Promise<void> | void;
  now?: () => Date;
}

export const refundItemSelection = {
  cogsReversalAmount: true,
  createdAt: true,
  id: true,
  originalCostBasisState: true,
  originalUnitCost: true,
  productId: true,
  refundQuantity: true,
  restockQuantity: true,
  reversedLineDiscount: true,
  reversedLineGross: true,
  reversedLineNet: true,
  reversedLineOutputVat: true,
  reversedLineTaxable: true,
  saleItemId: true,
} satisfies Prisma.SaleRefundItemSelect;

export const refundSelection = {
  actorDisplayNameSnapshot: true,
  branchId: true,
  canonicalRequestHash: true,
  completedAt: true,
  currency: true,
  discountAmount: true,
  grossAmount: true,
  id: true,
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: refundItemSelection,
  },
  organizationId: true,
  outputVatAmount: true,
  payment: {
    select: {
      amount: true,
      method: true,
      transferReference: true,
    },
  },
  reason: true,
  reference: true,
  saleId: true,
  salesVatRateSnapshot: true,
  salesVatStatusSnapshot: true,
  taxableAmount: true,
  totalAmount: true,
} satisfies Prisma.SaleRefundSelect;

export type SelectedRefund = Prisma.SaleRefundGetPayload<{
  select: typeof refundSelection;
}>;

export function safeRefund(
  refund: SelectedRefund,
  includeCosts: boolean,
): SafeSaleRefund {
  if (
    refund.currency !== "THB" ||
    refund.salesVatStatusSnapshot === "UNCONFIGURED" ||
    refund.payment === null
  ) {
    throw new Error("SaleRefund has an invalid persisted shape.");
  }
  return {
    actorDisplayName: refund.actorDisplayNameSnapshot,
    branchId: refund.branchId,
    completedAt: refund.completedAt.toISOString(),
    currency: "THB",
    discountAmount: refund.discountAmount.toFixed(2),
    grossAmount: refund.grossAmount.toFixed(2),
    id: refund.id,
    items: refund.items.map((item) => ({
      ...(includeCosts
        ? {
            cogsReversalAmount: item.cogsReversalAmount?.toFixed(10) ?? null,
            originalCostBasisState: item.originalCostBasisState,
            originalUnitCost: item.originalUnitCost?.toFixed(6) ?? null,
          }
        : {}),
      id: item.id,
      productId: item.productId,
      refundQuantity: canonicalQuantity(item.refundQuantity),
      restockQuantity: canonicalQuantity(item.restockQuantity),
      reversedLineDiscount: item.reversedLineDiscount.toFixed(2),
      reversedLineGross: item.reversedLineGross.toFixed(2),
      reversedLineNet: item.reversedLineNet.toFixed(2),
      reversedLineOutputVat: item.reversedLineOutputVat.toFixed(2),
      reversedLineTaxable: item.reversedLineTaxable?.toFixed(2) ?? null,
      saleItemId: item.saleItemId,
    })),
    organizationId: refund.organizationId,
    outputVatAmount: refund.outputVatAmount.toFixed(2),
    payment: {
      amount: refund.payment.amount.toFixed(2),
      method: refund.payment.method,
      reference: refund.payment.transferReference,
    },
    reason: refund.reason,
    reference: refund.reference,
    saleId: refund.saleId,
    salesVatRate: refund.salesVatRateSnapshot?.toString() ?? null,
    salesVatStatus: refund.salesVatStatusSnapshot,
    taxableAmount: refund.taxableAmount?.toFixed(2) ?? null,
    totalAmount: refund.totalAmount.toFixed(2),
  };
}

async function advisoryLock(
  transaction: Transaction,
  key: bigint,
): Promise<void> {
  await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    SELECT 1::integer AS "locked"
    FROM (SELECT pg_advisory_xact_lock(${key.toString()}::bigint)) AS "refund_lock"
  `);
}

type RefundAuthorization = {
  actorDisplayName: string;
  actorMembershipId: string;
  actorUserId: string;
};

async function authorizeRefund(
  transaction: Transaction,
  input: { actorUserId: string; branchId: string; organizationId: string },
): Promise<
  | { authorization: RefundAuthorization; kind: "allowed" }
  | { kind: "forbidden" }
  | { kind: "branch_inactive" }
> {
  const organizations = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
      FROM "organizations"
      WHERE "id" = ${input.organizationId}::uuid
        AND "status" = 'ACTIVE'
      FOR SHARE
    `,
  );
  if (organizations[0] === undefined) return { kind: "forbidden" };
  const users = await transaction.$queryRaw<
    Array<{ displayName: string | null; id: string }>
  >(Prisma.sql`
    SELECT "id", "display_name" AS "displayName"
    FROM "users"
    WHERE "id" = ${input.actorUserId}::uuid
      AND "status" = 'ACTIVE'
    FOR SHARE
  `);
  const user = users[0];
  if (user === undefined) return { kind: "forbidden" };
  const branches = await transaction.$queryRaw<
    Array<{ id: string; organizationId: string; status: "ACTIVE" | "INACTIVE" }>
  >(Prisma.sql`
    SELECT "id", "organization_id" AS "organizationId", "status"::text AS "status"
    FROM "branches"
    WHERE "id" = ${input.branchId}::uuid
      AND "organization_id" = ${input.organizationId}::uuid
    FOR SHARE
  `);
  const branch = branches[0];
  if (branch === undefined) return { kind: "forbidden" };
  const membership = await transaction.organizationMembership.findUnique({
    select: {
      branchAssignments: {
        select: {
          branchId: true,
          organizationId: true,
          status: true,
          userId: true,
        },
      },
      id: true,
      organizationId: true,
      role: true,
      status: true,
      userId: true,
    },
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
      },
    },
  });
  if (membership === null) return { kind: "forbidden" };
  const context = createTrustedAuthorizationContext({
    actor: { id: user.id, status: "ACTIVE" },
    branchAssignments: membership.branchAssignments,
    membership,
  });
  const scope = createTrustedBranchScope({
    branchId: branch.id,
    branchOrganizationId: branch.organizationId,
    organizationId: input.organizationId,
  });
  if (!can(context, PERMISSIONS.SALES_REFUND_CREATE, scope)) {
    return { kind: "forbidden" };
  }
  if (branch.status !== "ACTIVE") return { kind: "branch_inactive" };
  const displayName = user.displayName?.trim();
  return {
    authorization: {
      actorDisplayName:
        displayName === undefined || displayName === "" ? user.id : displayName,
      actorMembershipId: membership.id,
      actorUserId: user.id,
    },
    kind: "allowed",
  };
}

const lockedSaleSelection = {
  branchId: true,
  id: true,
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      cogsAmount: true,
      costBasisState: true,
      id: true,
      lineDiscount: true,
      lineNet: true,
      lineOutputVat: true,
      productId: true,
      productUnitSnapshot: true,
      quantity: true,
      refundItems: {
        select: {
          cogsReversalAmount: true,
          refundQuantity: true,
          restockQuantity: true,
          reversedLineDiscount: true,
          reversedLineNet: true,
          reversedLineOutputVat: true,
        },
      },
      unitCost: true,
    },
  },
  organizationId: true,
  payment: { select: { method: true } },
  salesVatRateSnapshot: true,
  salesVatStatusSnapshot: true,
} satisfies Prisma.SaleSelect;

type LockedSale = Prisma.SaleGetPayload<{
  select: typeof lockedSaleSelection;
}>;

async function lockSale(
  transaction: Transaction,
  input: { branchId: string; organizationId: string; saleId: string },
): Promise<LockedSale | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "sales"
    WHERE "id" = ${input.saleId}::uuid
      AND "organization_id" = ${input.organizationId}::uuid
      AND "branch_id" = ${input.branchId}::uuid
    FOR UPDATE
  `);
  if (rows[0] === undefined) return null;
  return transaction.sale.findUnique({
    select: lockedSaleSelection,
    where: { id: input.saleId },
  });
}

function sum(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (total, value) => total.plus(value),
    exactRefundDecimal("0"),
  );
}

function integerDigitsFit(value: Prisma.Decimal, maximum: number): boolean {
  const [integerDigits = ""] = value.abs().toFixed().split(".");
  return (integerDigits.replace(/^0+/, "") || "0").length <= maximum;
}

function retryableTransactionConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "40P01" || error.code === "40001";
}

export function createPrismaRefundRepository(
  prisma: PrismaClient,
  options: RefundRepositoryOptions = {},
): RefundRepository {
  const now = options.now ?? (() => new Date());
  return {
    async createRefund(input) {
      if (!validRefundIdempotencyKey(input.idempotencyKey)) {
        return { kind: "invalid_idempotency_key" };
      }
      const canonical = canonicalizeRefundIntent(input);
      if (canonical.kind !== "valid") return canonical;
      const keyHash = refundIdempotencyKeyHash(input.idempotencyKey);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (transaction) => {
            await advisoryLock(
              transaction,
              inventoryIdempotencyAdvisoryLockKey(
                input.organizationId,
                `SALE_REFUND:${keyHash}`,
              ),
            );
            const access = await authorizeRefund(transaction, input);
            if (access.kind !== "allowed") return access;
            const sale = await lockSale(transaction, input);
            if (sale === null || sale.payment === null) {
              return { kind: "not_found" } as const;
            }
            if (sale.salesVatStatusSnapshot === "UNCONFIGURED") {
              throw new Error("Completed Sale has an invalid VAT snapshot.");
            }
            if (
              (sale.payment.method === "CASH" &&
                canonical.intent.transferReference !== null) ||
              (sale.payment.method === "TRANSFER" &&
                canonical.intent.transferReference === null)
            ) {
              return { kind: "invalid_transfer_reference" } as const;
            }
            const requestHash = refundCanonicalRequestHash({
              actorUserId: input.actorUserId,
              branchId: input.branchId,
              intent: canonical.intent,
              organizationId: input.organizationId,
              paymentMethod: sale.payment.method,
              saleId: input.saleId,
            });
            const prior = await transaction.saleRefund.findUnique({
              select: refundSelection,
              where: {
                organizationId_idempotencyOperation_idempotencyKeyHash: {
                  idempotencyKeyHash: keyHash,
                  idempotencyOperation: "SALE_REFUND",
                  organizationId: input.organizationId,
                },
              },
            });
            if (prior !== null) {
              if (prior.canonicalRequestHash !== requestHash) {
                return { kind: "idempotency_conflict" } as const;
              }
              return {
                kind: "replay",
                refund: safeRefund(prior, true),
              } as const;
            }

            const fullyRefunded = sale.items.every((item) =>
              sum(
                item.refundItems.map((refund) => refund.refundQuantity),
              ).equals(item.quantity),
            );
            if (fullyRefunded) {
              return { kind: "sale_already_fully_refunded" } as const;
            }
            const saleItems = new Map(
              sale.items.map((item) => [item.id, item]),
            );
            const planned = [] as Array<{
              amounts: ReturnType<typeof calculateRefundLineAmounts>;
              item: LockedSale["items"][number];
              quantity: Prisma.Decimal;
              restockQuantity: Prisma.Decimal;
            }>;
            for (const requested of canonical.intent.items) {
              const item = saleItems.get(requested.saleItemId);
              if (item === undefined) return { kind: "not_found" } as const;
              if (
                (["EA", "PACK", "BOX"] as const).includes(
                  item.productUnitSnapshot as "EA" | "PACK" | "BOX",
                ) &&
                (!requested.quantity.isInteger() ||
                  !requested.restockQuantity.isInteger())
              ) {
                return { kind: "invalid_quantity" } as const;
              }
              const priorQuantity = sum(
                item.refundItems.map((refund) => refund.refundQuantity),
              );
              const cumulativeQuantity = priorQuantity.plus(requested.quantity);
              if (cumulativeQuantity.greaterThan(item.quantity)) {
                return { kind: "refund_quantity_exceeded" } as const;
              }
              const priorRestockQuantity = sum(
                item.refundItems.map((refund) => refund.restockQuantity),
              );
              const cumulativeRestockQuantity = priorRestockQuantity.plus(
                requested.restockQuantity,
              );
              planned.push({
                amounts: calculateRefundLineAmounts({
                  cumulativeQuantity,
                  cumulativeRestockQuantity,
                  originalCogsAmount: item.cogsAmount,
                  originalLineDiscount: item.lineDiscount,
                  originalLineNet: item.lineNet,
                  originalLineOutputVat: item.lineOutputVat,
                  originalQuantity: item.quantity,
                  priorCogsReversal:
                    item.costBasisState === "KNOWN"
                      ? sum(
                          item.refundItems.map(
                            (refund) =>
                              refund.cogsReversalAmount ??
                              exactRefundDecimal("0"),
                          ),
                        )
                      : null,
                  priorLineDiscount: sum(
                    item.refundItems.map(
                      (refund) => refund.reversedLineDiscount,
                    ),
                  ),
                  priorLineNet: sum(
                    item.refundItems.map((refund) => refund.reversedLineNet),
                  ),
                  priorLineOutputVat: sum(
                    item.refundItems.map(
                      (refund) => refund.reversedLineOutputVat,
                    ),
                  ),
                  salesVatStatus: sale.salesVatStatusSnapshot,
                }),
                item,
                quantity: requested.quantity,
                restockQuantity: requested.restockQuantity,
              });
            }

            const grossAmount = sum(
              planned.map((line) => line.amounts.reversedLineGross),
            );
            const discountAmount = sum(
              planned.map((line) => line.amounts.reversedLineDiscount),
            );
            const totalAmount = sum(
              planned.map((line) => line.amounts.reversedLineNet),
            );
            const outputVatAmount = sum(
              planned.map((line) => line.amounts.reversedLineOutputVat),
            );
            const taxableAmount =
              sale.salesVatStatusSnapshot === "REGISTERED"
                ? sum(
                    planned.map((line) => {
                      if (line.amounts.reversedLineTaxable === null) {
                        throw new Error(
                          "Registered refund line is missing taxable value.",
                        );
                      }
                      return line.amounts.reversedLineTaxable;
                    }),
                  )
                : null;
            if (!totalAmount.greaterThan(0)) {
              return { kind: "zero_refund_amount" } as const;
            }

            const restocked = planned
              .filter((line) => line.restockQuantity.greaterThan(0))
              .sort((left, right) =>
                left.item.productId.localeCompare(right.item.productId),
              );
            for (const line of restocked) {
              await advisoryLock(
                transaction,
                inventoryBalanceAdvisoryLockKey(
                  input.branchId,
                  line.item.productId,
                ),
              );
            }
            await options.afterProductLocksAcquired?.();

            const inventory = new Map<
              string,
              {
                balanceId: string | null;
                costState: {
                  averageUnitCost: Prisma.Decimal | null;
                  basisState: "KNOWN" | "UNKNOWN";
                  id: string;
                  inventoryValue: Prisma.Decimal | null;
                } | null;
                quantity: Prisma.Decimal;
              }
            >();
            for (const line of restocked) {
              const balances = await transaction.$queryRaw<
                Array<{ id: string; quantity: Prisma.Decimal }>
              >(Prisma.sql`
                SELECT "id", "quantity"
                FROM "inventory_balances"
                WHERE "organization_id" = ${input.organizationId}::uuid
                  AND "branch_id" = ${input.branchId}::uuid
                  AND "product_id" = ${line.item.productId}::uuid
                FOR UPDATE
              `);
              const costs = await transaction.$queryRaw<
                Array<{
                  averageUnitCost: Prisma.Decimal | null;
                  basisState: "KNOWN" | "UNKNOWN";
                  id: string;
                  inventoryValue: Prisma.Decimal | null;
                }>
              >(Prisma.sql`
                SELECT
                  "id",
                  "basis_state"::text AS "basisState",
                  "inventory_value" AS "inventoryValue",
                  "average_unit_cost" AS "averageUnitCost"
                FROM "inventory_cost_states"
                WHERE "organization_id" = ${input.organizationId}::uuid
                  AND "branch_id" = ${input.branchId}::uuid
                  AND "product_id" = ${line.item.productId}::uuid
                FOR UPDATE
              `);
              inventory.set(line.item.id, {
                balanceId: balances[0]?.id ?? null,
                costState: costs[0] ?? null,
                quantity: balances[0]?.quantity ?? exactRefundDecimal("0"),
              });
            }

            const completedAt = now();
            const refundId = randomUUID();
            await transaction.saleRefund.create({
              data: {
                actorDisplayNameSnapshot: access.authorization.actorDisplayName,
                actorMembershipId: access.authorization.actorMembershipId,
                actorUserId: access.authorization.actorUserId,
                branchId: input.branchId,
                canonicalRequestHash: requestHash,
                completedAt,
                discountAmount,
                grossAmount,
                id: refundId,
                idempotencyKeyHash: keyHash,
                organizationId: input.organizationId,
                outputVatAmount,
                reason: canonical.intent.reason,
                reference: `REFUND-${refundId}`,
                saleId: input.saleId,
                salesVatRateSnapshot: sale.salesVatRateSnapshot,
                salesVatStatusSnapshot: sale.salesVatStatusSnapshot,
                taxableAmount,
                totalAmount,
              },
            });
            await options.afterStage?.("refund_created");

            for (const [lineIndex, line] of planned.entries()) {
              const refundItem = await transaction.saleRefundItem.create({
                data: {
                  branchId: input.branchId,
                  cogsReversalAmount: line.amounts.cogsReversalAmount,
                  organizationId: input.organizationId,
                  originalCostBasisState: line.item.costBasisState,
                  originalUnitCost: line.item.unitCost,
                  productId: line.item.productId,
                  refundQuantity: line.quantity,
                  restockQuantity: line.restockQuantity,
                  reversedLineDiscount: line.amounts.reversedLineDiscount,
                  reversedLineGross: line.amounts.reversedLineGross,
                  reversedLineNet: line.amounts.reversedLineNet,
                  reversedLineOutputVat: line.amounts.reversedLineOutputVat,
                  reversedLineTaxable: line.amounts.reversedLineTaxable,
                  saleId: input.saleId,
                  saleItemId: line.item.id,
                  saleRefundId: refundId,
                },
              });
              await options.afterStage?.("refund_item_created", lineIndex);
              if (line.restockQuantity.greaterThan(0)) {
                const state = inventory.get(line.item.id);
                if (state === undefined) {
                  throw new Error("Restock inventory was not locked.");
                }
                const newQuantity = state.quantity.plus(line.restockQuantity);
                if (!inventoryQuantityFitsStorage(newQuantity)) {
                  return { kind: "invalid_quantity" } as const;
                }
                if (state.balanceId === null) {
                  await transaction.inventoryBalance.create({
                    data: {
                      branchId: input.branchId,
                      organizationId: input.organizationId,
                      productId: line.item.productId,
                      quantity: newQuantity,
                    },
                  });
                } else {
                  await transaction.inventoryBalance.update({
                    data: { quantity: newQuantity },
                    where: { id: state.balanceId },
                  });
                }
                await options.afterStage?.(
                  "inventory_balance_updated",
                  lineIndex,
                );

                let basisState: "KNOWN" | "UNKNOWN" = "UNKNOWN";
                let averageUnitCost: Prisma.Decimal | null = null;
                let inventoryValue: Prisma.Decimal | null = null;
                if (
                  line.item.costBasisState === "KNOWN" &&
                  line.item.unitCost !== null &&
                  (state.quantity.isZero() ||
                    state.costState?.basisState === "KNOWN")
                ) {
                  basisState = "KNOWN";
                  if (state.quantity.isZero()) {
                    averageUnitCost = line.item.unitCost;
                    inventoryValue = newQuantity
                      .times(averageUnitCost)
                      .toDecimalPlaces(10, Prisma.Decimal.ROUND_HALF_UP);
                  } else {
                    if (
                      state.costState?.averageUnitCost === null ||
                      state.costState?.averageUnitCost === undefined ||
                      state.costState.inventoryValue === null
                    ) {
                      throw new Error(
                        "Known inventory cost state is incomplete.",
                      );
                    }
                    const exactValue = state.quantity
                      .times(state.costState.averageUnitCost)
                      .plus(line.restockQuantity.times(line.item.unitCost));
                    averageUnitCost = exactValue
                      .dividedBy(newQuantity)
                      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
                    inventoryValue = exactValue.toDecimalPlaces(
                      10,
                      Prisma.Decimal.ROUND_HALF_UP,
                    );
                  }
                  if (
                    !integerDigitsFit(averageUnitCost, 13) ||
                    !integerDigitsFit(inventoryValue, 28)
                  ) {
                    throw new Error(
                      "Refund return cost exceeds accepted storage.",
                    );
                  }
                }
                await transaction.inventoryCostState.upsert({
                  create: {
                    averageUnitCost,
                    basisState,
                    branchId: input.branchId,
                    inventoryValue,
                    organizationId: input.organizationId,
                    productId: line.item.productId,
                  },
                  update: { averageUnitCost, basisState, inventoryValue },
                  where: {
                    branchId_productId: {
                      branchId: input.branchId,
                      productId: line.item.productId,
                    },
                  },
                });
                await options.afterStage?.("inventory_cost_updated", lineIndex);
                await transaction.inventoryTransaction.create({
                  data: {
                    actorMembershipId: access.authorization.actorMembershipId,
                    actorUserId: access.authorization.actorUserId,
                    branchId: input.branchId,
                    delta: line.restockQuantity,
                    occurredAt: completedAt,
                    organizationId: input.organizationId,
                    productId: line.item.productId,
                    saleRefundItemId: refundItem.id,
                    source: "SALE_REFUND_RETURN",
                  },
                });
                await options.afterStage?.(
                  "inventory_ledger_created",
                  lineIndex,
                );
              }
              await options.afterLineCommitted?.(lineIndex);
            }
            await transaction.refundPayment.create({
              data: {
                amount: totalAmount,
                branchId: input.branchId,
                confirmedAt: completedAt,
                method: sale.payment.method,
                organizationId: input.organizationId,
                saleId: input.saleId,
                saleRefundId: refundId,
                transferReference: canonical.intent.transferReference,
              },
            });
            await options.afterStage?.("payment_created");
            const completed = await transaction.saleRefund.findUniqueOrThrow({
              select: refundSelection,
              where: { id: refundId },
            });
            return {
              kind: "success",
              refund: safeRefund(completed, true),
            } as const;
          });
        } catch (error: unknown) {
          if (retryableTransactionConflict(error) && attempt < 2) continue;
          throw error;
        }
      }
      throw new Error("Refund retry loop exhausted unexpectedly.");
    },
  };
}
