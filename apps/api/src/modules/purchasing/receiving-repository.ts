import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import {
  canonicalQuantity,
  inventoryQuantityFitsStorage,
} from "../inventory/inventory-values.ts";
import { inventoryBalanceAdvisoryLockKey } from "../inventory/inventory-repository.ts";
import {
  can,
  createTrustedAuthorizationContext,
  createTrustedBranchScope,
  PERMISSIONS,
} from "../identity/authorization-policy.ts";
import {
  canonicalInputVatSnapshot,
  parseActualUnitCost,
  receivingCanonicalRequestHash,
  receivingIdempotencyKeyHash,
  type InputVatSnapshotInput,
} from "./receiving-values.ts";

type Transaction = Prisma.TransactionClient;

export interface ReceivePurchaseOrderInput {
  actorUserId: string;
  actualCosts: readonly {
    actualUnitCost: string;
    purchaseOrderItemId: string;
  }[];
  idempotencyKey: string;
  organizationId: string;
  purchaseOrderId: string;
  vat: InputVatSnapshotInput;
}

export interface SafePurchaseReceiptItem {
  actualUnitCost: string;
  id: string;
  productId: string;
  productNameSnapshot: string;
  productSkuSnapshot: string;
  purchaseOrderItemId: string;
  receivedQuantity: string;
}

export interface SafePurchaseReceipt {
  branchId: string;
  createdAt: string;
  id: string;
  inputVatAmount: string | null;
  inputVatRate: string | null;
  items: SafePurchaseReceiptItem[];
  organizationId: string;
  organizationVatRegisteredSnapshot: boolean;
  purchaseOrderId: string;
  receivedAt: string;
  receivedByMembershipId: string;
  receivedByUserId: string;
  reference: string;
  supplierId: string;
  supplierTaxDocumentDate: string | null;
  supplierTaxDocumentNumber: string | null;
}

export type ReceivingOutcome =
  | { kind: "success"; receipt: SafePurchaseReceipt }
  | { kind: "replay"; receipt: SafePurchaseReceipt }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "branch_inactive" }
  | { kind: "product_inactive" }
  | { kind: "invalid_transition" }
  | { kind: "invalid_costs" }
  | { kind: "invalid_vat" }
  | { kind: "invalid_quantity" }
  | { kind: "idempotency_conflict" }
  | { kind: "reference_conflict" };

export interface ReceivingRepository {
  receivePurchaseOrder(
    input: ReceivePurchaseOrderInput,
  ): Promise<ReceivingOutcome>;
}

export interface ReceivingRepositoryOptions {
  afterLineCommitted?: (lineIndex: number) => Promise<void> | void;
  now?: () => Date;
}

class ReceivingAbort extends Error {
  constructor(
    readonly outcome: { kind: "invalid_costs" } | { kind: "invalid_quantity" },
  ) {
    super(outcome.kind);
  }
}

const receiptItemSelection = {
  actualUnitCost: true,
  id: true,
  productId: true,
  productNameSnapshot: true,
  productSkuSnapshot: true,
  purchaseOrderItemId: true,
  receivedQuantity: true,
} satisfies Prisma.PurchaseReceiptItemSelect;

const receiptSelection = {
  branchId: true,
  canonicalRequestHash: true,
  createdAt: true,
  id: true,
  inputVatAmount: true,
  inputVatRate: true,
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: receiptItemSelection,
  },
  organizationId: true,
  organizationVatRegisteredSnapshot: true,
  purchaseOrderId: true,
  receivedAt: true,
  receivedByMembershipId: true,
  receivedByUserId: true,
  reference: true,
  supplierId: true,
  supplierTaxDocumentDate: true,
  supplierTaxDocumentNumber: true,
} satisfies Prisma.PurchaseReceiptSelect;

type SelectedReceipt = Prisma.PurchaseReceiptGetPayload<{
  select: typeof receiptSelection;
}>;

function safeReceipt(receipt: SelectedReceipt): SafePurchaseReceipt {
  return {
    branchId: receipt.branchId,
    createdAt: receipt.createdAt.toISOString(),
    id: receipt.id,
    inputVatAmount: receipt.inputVatAmount?.toFixed(4) ?? null,
    inputVatRate: receipt.inputVatRate?.toFixed(6) ?? null,
    items: receipt.items.map((item) => ({
      actualUnitCost: item.actualUnitCost.toFixed(4),
      id: item.id,
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      productSkuSnapshot: item.productSkuSnapshot,
      purchaseOrderItemId: item.purchaseOrderItemId,
      receivedQuantity: canonicalQuantity(item.receivedQuantity),
    })),
    organizationId: receipt.organizationId,
    organizationVatRegisteredSnapshot:
      receipt.organizationVatRegisteredSnapshot,
    purchaseOrderId: receipt.purchaseOrderId,
    receivedAt: receipt.receivedAt.toISOString(),
    receivedByMembershipId: receipt.receivedByMembershipId,
    receivedByUserId: receipt.receivedByUserId,
    reference: receipt.reference,
    supplierId: receipt.supplierId,
    supplierTaxDocumentDate:
      receipt.supplierTaxDocumentDate?.toISOString().slice(0, 10) ?? null,
    supplierTaxDocumentNumber: receipt.supplierTaxDocumentNumber,
  };
}

const ADVISORY_LOCK_MAGNITUDE_MASK = (1n << 63n) - 1n;

function receiptAdvisoryKey(identity: string): bigint {
  const digest = createHash("sha256")
    .update(`stockwise-receiving-receipt\0${identity}`, "utf8")
    .digest();
  const magnitude = digest.readBigUInt64BE(0) & ADVISORY_LOCK_MAGNITUDE_MASK;
  return magnitude;
}

async function advisoryLock(
  transaction: Transaction,
  key: bigint,
): Promise<void> {
  await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    SELECT 1::integer AS "locked"
    FROM (SELECT pg_advisory_xact_lock(${key.toString()}::bigint)) AS "receiving_lock"
  `);
}

async function authorizeReceiving(
  transaction: Transaction,
  input: { actorUserId: string; branchId: string; organizationId: string },
): Promise<
  | { kind: "allowed"; membershipId: string }
  | { kind: "forbidden" }
  | { kind: "branch_inactive" }
> {
  const membership = await transaction.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
      },
    },
    select: {
      branchAssignments: {
        where: { status: "ACTIVE", branch: { status: "ACTIVE" } },
        select: {
          branchId: true,
          organizationId: true,
          status: true,
          userId: true,
        },
      },
      id: true,
      organization: { select: { status: true } },
      organizationId: true,
      role: true,
      status: true,
      user: { select: { id: true, status: true } },
      userId: true,
    },
  });
  if (membership === null || membership.organization.status !== "ACTIVE") {
    return { kind: "forbidden" };
  }
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
  if (branch.status !== "ACTIVE") return { kind: "branch_inactive" };
  const context = createTrustedAuthorizationContext({
    actor: membership.user,
    branchAssignments: membership.branchAssignments,
    membership: {
      organizationId: membership.organizationId,
      role: membership.role,
      status: membership.status,
      userId: membership.userId,
    },
  });
  const scope = createTrustedBranchScope({
    branchId: branch.id,
    branchOrganizationId: branch.organizationId,
    organizationId: input.organizationId,
  });
  if (
    context === null ||
    scope === null ||
    !can(context, PERMISSIONS.RECEIVING_PERFORM, scope)
  ) {
    return { kind: "forbidden" };
  }
  return { kind: "allowed", membershipId: membership.id };
}

async function lockPurchaseOrder(
  transaction: Transaction,
  organizationId: string,
  purchaseOrderId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "purchase_orders"
    WHERE "id" = ${purchaseOrderId}::uuid
      AND "organization_id" = ${organizationId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}

function referenceConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  return (
    target === "purchase_receipts_organization_id_reference_key" ||
    (Array.isArray(target) && target.includes("reference"))
  );
}

function integerDigitsFit(value: Prisma.Decimal, maximum: number): boolean {
  const [integerDigits = ""] = value.abs().toFixed().split(".");
  return (integerDigits.replace(/^0+/, "") || "0").length <= maximum;
}

export function createPrismaReceivingRepository(
  prisma: PrismaClient,
  options: ReceivingRepositoryOptions = {},
): ReceivingRepository {
  const now = options.now ?? (() => new Date());
  return {
    async receivePurchaseOrder(input) {
      const vat = canonicalInputVatSnapshot(input.vat);
      if (vat === null) return { kind: "invalid_vat" };
      const costIds = new Set<string>();
      const actualCosts = new Map<string, Prisma.Decimal>();
      const canonicalCosts: Array<{
        actualUnitCost: string;
        purchaseOrderItemId: string;
      }> = [];
      for (const line of input.actualCosts) {
        const cost = parseActualUnitCost(line.actualUnitCost);
        if (cost === null || costIds.has(line.purchaseOrderItemId)) {
          return { kind: "invalid_costs" };
        }
        costIds.add(line.purchaseOrderItemId);
        actualCosts.set(line.purchaseOrderItemId, cost);
        canonicalCosts.push({
          actualUnitCost: cost.toFixed(4),
          purchaseOrderItemId: line.purchaseOrderItemId,
        });
      }
      const keyHash = receivingIdempotencyKeyHash(input.idempotencyKey);
      const requestHash = receivingCanonicalRequestHash({
        actualCosts: canonicalCosts,
        purchaseOrderId: input.purchaseOrderId,
        vat,
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (transaction) => {
            await advisoryLock(
              transaction,
              receiptAdvisoryKey(`${input.organizationId}:${keyHash}`),
            );
            const prior = await transaction.purchaseReceipt.findUnique({
              where: {
                organizationId_idempotencyKeyHash: {
                  idempotencyKeyHash: keyHash,
                  organizationId: input.organizationId,
                },
              },
              select: receiptSelection,
            });
            if (prior !== null) {
              const access = await authorizeReceiving(transaction, {
                actorUserId: input.actorUserId,
                branchId: prior.branchId,
                organizationId: input.organizationId,
              });
              if (access.kind !== "allowed") return access;
              if (prior.canonicalRequestHash !== requestHash) {
                return { kind: "idempotency_conflict" } as const;
              }
              return { kind: "replay", receipt: safeReceipt(prior) } as const;
            }

            if (
              !(await lockPurchaseOrder(
                transaction,
                input.organizationId,
                input.purchaseOrderId,
              ))
            ) {
              return { kind: "not_found" } as const;
            }
            const order = await transaction.purchaseOrder.findFirst({
              where: {
                id: input.purchaseOrderId,
                organizationId: input.organizationId,
              },
              select: {
                branchId: true,
                id: true,
                items: {
                  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                  select: {
                    id: true,
                    productId: true,
                    productNameSnapshot: true,
                    productSkuSnapshot: true,
                    quantity: true,
                  },
                },
                status: true,
                supplierId: true,
              },
            });
            if (order === null) return { kind: "not_found" } as const;
            const access = await authorizeReceiving(transaction, {
              actorUserId: input.actorUserId,
              branchId: order.branchId,
              organizationId: input.organizationId,
            });
            if (access.kind !== "allowed") return access;
            if (order.status !== "ORDERED")
              return { kind: "invalid_transition" } as const;
            if (
              order.items.length === 0 ||
              order.items.length !== actualCosts.size
            ) {
              return { kind: "invalid_costs" } as const;
            }
            for (const item of order.items) {
              if (!actualCosts.has(item.id))
                return { kind: "invalid_costs" } as const;
            }

            const productUnits = new Map<string, string>();
            for (const productId of order.items
              .map((item) => item.productId)
              .sort()) {
              const products = await transaction.$queryRaw<
                Array<{ status: "ACTIVE" | "INACTIVE"; unit: string }>
              >(Prisma.sql`
                SELECT "status"::text AS "status", "unit"::text AS "unit"
                FROM "products"
                WHERE "id" = ${productId}::uuid
                  AND "organization_id" = ${input.organizationId}::uuid
                FOR SHARE
              `);
              if (products[0]?.status !== "ACTIVE") {
                return { kind: "product_inactive" } as const;
              }
              productUnits.set(productId, products[0].unit);
              await advisoryLock(
                transaction,
                inventoryBalanceAdvisoryLockKey(order.branchId, productId),
              );
            }

            const integralUnits = new Set(["EA", "PACK", "BOX"]);
            if (
              order.items.some(
                (item) =>
                  !item.quantity.isPositive() ||
                  (integralUnits.has(productUnits.get(item.productId) ?? "") &&
                    !item.quantity.isInteger()),
              )
            ) {
              return { kind: "invalid_quantity" } as const;
            }

            const receivedAt = now();
            const receipt = await transaction.purchaseReceipt.create({
              data: {
                branchId: order.branchId,
                canonicalRequestHash: requestHash,
                idempotencyKeyHash: keyHash,
                inputVatAmount: vat.inputVatAmount,
                inputVatRate: vat.inputVatRate,
                organizationId: input.organizationId,
                organizationVatRegisteredSnapshot:
                  vat.organizationVatRegistered,
                purchaseOrderId: order.id,
                receivedAt,
                receivedByMembershipId: access.membershipId,
                receivedByUserId: input.actorUserId,
                reference: `RCPT-${randomUUID()}`,
                supplierId: order.supplierId,
                supplierTaxDocumentDate:
                  vat.supplierTaxDocumentDate === null
                    ? null
                    : new Date(`${vat.supplierTaxDocumentDate}T00:00:00.000Z`),
                supplierTaxDocumentNumber: vat.supplierTaxDocumentNumber,
              },
            });

            for (const [lineIndex, item] of order.items.entries()) {
              const actualUnitCost = actualCosts.get(item.id);
              if (actualUnitCost === undefined) {
                throw new ReceivingAbort({ kind: "invalid_costs" });
              }
              const balances = await transaction.$queryRaw<
                Array<{ id: string; quantity: Prisma.Decimal }>
              >(Prisma.sql`
                SELECT "id", "quantity"
                FROM "inventory_balances"
                WHERE "branch_id" = ${order.branchId}::uuid
                  AND "product_id" = ${item.productId}::uuid
                  AND "organization_id" = ${input.organizationId}::uuid
                FOR UPDATE
              `);
              const currentBalance = balances[0];
              const oldQuantity =
                currentBalance?.quantity ?? new Prisma.Decimal(0);
              const newQuantity = oldQuantity.plus(item.quantity);
              if (!inventoryQuantityFitsStorage(newQuantity)) {
                throw new ReceivingAbort({ kind: "invalid_quantity" });
              }
              if (currentBalance === undefined) {
                await transaction.inventoryBalance.create({
                  data: {
                    branchId: order.branchId,
                    organizationId: input.organizationId,
                    productId: item.productId,
                    quantity: newQuantity,
                  },
                });
              } else {
                await transaction.inventoryBalance.update({
                  data: { quantity: newQuantity },
                  where: { id: currentBalance.id },
                });
              }

              const costStates = await transaction.$queryRaw<
                Array<{
                  averageUnitCost: Prisma.Decimal | null;
                  basisState: "UNKNOWN" | "KNOWN";
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
                WHERE "branch_id" = ${order.branchId}::uuid
                  AND "product_id" = ${item.productId}::uuid
                  AND "organization_id" = ${input.organizationId}::uuid
                FOR UPDATE
              `);
              const currentCost = costStates[0];
              let inventoryValue: Prisma.Decimal;
              let averageUnitCost: Prisma.Decimal;
              if (
                currentCost === undefined ||
                currentCost.basisState === "UNKNOWN" ||
                oldQuantity.isZero()
              ) {
                averageUnitCost = actualUnitCost.toDecimalPlaces(
                  6,
                  Prisma.Decimal.ROUND_HALF_UP,
                );
                inventoryValue = newQuantity
                  .times(averageUnitCost)
                  .toDecimalPlaces(10, Prisma.Decimal.ROUND_HALF_UP);
              } else {
                if (
                  currentCost.inventoryValue === null ||
                  currentCost.averageUnitCost === null
                ) {
                  throw new Error(
                    "Known inventory cost state is missing its numeric values.",
                  );
                }
                const exactInventoryValue = oldQuantity
                  .times(currentCost.averageUnitCost)
                  .plus(item.quantity.times(actualUnitCost));
                averageUnitCost = exactInventoryValue
                  .dividedBy(newQuantity)
                  .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
                inventoryValue = exactInventoryValue.toDecimalPlaces(
                  10,
                  Prisma.Decimal.ROUND_HALF_UP,
                );
              }
              if (
                !integerDigitsFit(inventoryValue, 28) ||
                !integerDigitsFit(averageUnitCost, 13)
              ) {
                throw new ReceivingAbort({ kind: "invalid_costs" });
              }
              await transaction.inventoryCostState.upsert({
                create: {
                  averageUnitCost,
                  basisState: "KNOWN",
                  branchId: order.branchId,
                  inventoryValue,
                  organizationId: input.organizationId,
                  productId: item.productId,
                },
                update: {
                  averageUnitCost,
                  basisState: "KNOWN",
                  inventoryValue,
                },
                where: {
                  branchId_productId: {
                    branchId: order.branchId,
                    productId: item.productId,
                  },
                },
              });

              const receiptItem = await transaction.purchaseReceiptItem.create({
                data: {
                  actualUnitCost,
                  branchId: order.branchId,
                  organizationId: input.organizationId,
                  productId: item.productId,
                  productNameSnapshot: item.productNameSnapshot,
                  productSkuSnapshot: item.productSkuSnapshot,
                  purchaseOrderId: order.id,
                  purchaseOrderItemId: item.id,
                  receiptId: receipt.id,
                  receivedQuantity: item.quantity,
                },
              });
              await transaction.inventoryTransaction.create({
                data: {
                  actorMembershipId: access.membershipId,
                  actorUserId: input.actorUserId,
                  branchId: order.branchId,
                  delta: item.quantity,
                  occurredAt: receivedAt,
                  organizationId: input.organizationId,
                  productId: item.productId,
                  purchaseReceiptItemId: receiptItem.id,
                  source: "PURCHASE_RECEIVE",
                },
              });
              await options.afterLineCommitted?.(lineIndex);
            }

            await transaction.purchaseOrder.update({
              data: { receivedAt, status: "RECEIVED" },
              where: { id: order.id },
            });
            const completed =
              await transaction.purchaseReceipt.findUniqueOrThrow({
                where: { id: receipt.id },
                select: receiptSelection,
              });
            return {
              kind: "success",
              receipt: safeReceipt(completed),
            } as const;
          });
        } catch (error: unknown) {
          if (error instanceof ReceivingAbort) return error.outcome;
          if (referenceConflict(error)) continue;
          throw error;
        }
      }
      return { kind: "reference_conflict" };
    },
  };
}
