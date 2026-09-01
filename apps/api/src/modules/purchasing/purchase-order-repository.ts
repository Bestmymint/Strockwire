import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import {
  can,
  createTrustedAuthorizationContext,
  createTrustedBranchScope,
  PERMISSIONS,
  type ResolvedAuthorizationState,
} from "../identity/authorization-policy.ts";
import type {
  PurchaseOrderCreateInput,
  PurchaseOrderListInput,
  PurchaseOrderUpdateInput,
} from "./purchase-order-schemas.ts";
import {
  canonicalPurchaseOrderQuantity,
  expectedPurchaseOrderTotal,
  parseExpectedUnitCost,
  parsePurchaseOrderQuantity,
  type PurchaseOrderUnit,
} from "./purchase-order-values.ts";

export interface SafePurchaseOrderItem {
  expectedUnitCost: string;
  id: string;
  productId: string;
  productNameSnapshot: string;
  productSkuSnapshot: string;
  quantity: string;
}

export interface SafePurchaseOrder {
  branchId: string;
  cancelledAt: string | null;
  createdAt: string;
  currency: "THB";
  expectedDate: string | null;
  expectedTotal: string;
  id: string;
  items: SafePurchaseOrderItem[];
  orderDate: string;
  orderedAt: string | null;
  organizationId: string;
  receivedAt: string | null;
  reference: string;
  status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";
  supplierId: string;
  updatedAt: string;
}

export type SafePurchaseOrderSummary = Omit<SafePurchaseOrder, "items">;

type AuthorizationFailure = { kind: "forbidden" };
type NotFound = { kind: "not_found" };
type LifecycleFailure =
  | { kind: "branch_inactive" }
  | { kind: "supplier_inactive" }
  | { kind: "product_inactive" }
  | { kind: "invalid_quantity" }
  | { kind: "invalid_cost" }
  | { kind: "duplicate_product" }
  | { kind: "invalid_transition" }
  | { kind: "stale" };

export type PurchaseOrderOutcome =
  | { kind: "success"; purchaseOrder: SafePurchaseOrder }
  | AuthorizationFailure
  | NotFound
  | { kind: "supplier_not_found" }
  | { kind: "product_not_found" }
  | LifecycleFailure
  | { kind: "reference_conflict" };
export type PurchaseOrderListOutcome =
  | {
      kind: "success";
      nextCursor: string | null;
      purchaseOrders: SafePurchaseOrderSummary[];
    }
  | AuthorizationFailure
  | { kind: "invalid_cursor" };

export interface PurchaseOrderRepository {
  createPurchaseOrder(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    purchaseOrder: PurchaseOrderCreateInput;
  }): Promise<PurchaseOrderOutcome>;
  getPurchaseOrder(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    purchaseOrderId: string;
  }): Promise<PurchaseOrderOutcome>;
  listPurchaseOrders(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    query: PurchaseOrderListInput;
  }): Promise<PurchaseOrderListOutcome>;
  updatePurchaseOrder(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    purchaseOrder: PurchaseOrderUpdateInput;
    purchaseOrderId: string;
  }): Promise<PurchaseOrderOutcome>;
}

type Transaction = Prisma.TransactionClient;

const itemSelection = {
  expectedUnitCost: true,
  id: true,
  productId: true,
  productNameSnapshot: true,
  productSkuSnapshot: true,
  quantity: true,
} satisfies Prisma.PurchaseOrderItemSelect;
const itemOrderBy: Prisma.PurchaseOrderItemOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];
const purchaseOrderSelection = {
  branchId: true,
  cancelledAt: true,
  createdAt: true,
  currency: true,
  expectedDate: true,
  expectedTotal: true,
  id: true,
  items: { orderBy: itemOrderBy, select: itemSelection },
  orderDate: true,
  orderedAt: true,
  organizationId: true,
  receivedAt: true,
  reference: true,
  status: true,
  supplierId: true,
  updatedAt: true,
} satisfies Prisma.PurchaseOrderSelect;
const purchaseOrderSummarySelection = {
  branchId: true,
  cancelledAt: true,
  createdAt: true,
  currency: true,
  expectedDate: true,
  expectedTotal: true,
  id: true,
  orderDate: true,
  orderedAt: true,
  organizationId: true,
  receivedAt: true,
  reference: true,
  status: true,
  supplierId: true,
  updatedAt: true,
} satisfies Prisma.PurchaseOrderSelect;

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function safeItem(item: {
  expectedUnitCost: Prisma.Decimal;
  id: string;
  productId: string;
  productNameSnapshot: string;
  productSkuSnapshot: string;
  quantity: Prisma.Decimal;
}): SafePurchaseOrderItem {
  return {
    ...item,
    expectedUnitCost: item.expectedUnitCost.toFixed(4),
    quantity: canonicalPurchaseOrderQuantity(item.quantity),
  };
}

function safePurchaseOrder(order: {
  branchId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  currency: string;
  expectedDate: Date | null;
  expectedTotal: Prisma.Decimal;
  id: string;
  items: Array<{
    expectedUnitCost: Prisma.Decimal;
    id: string;
    productId: string;
    productNameSnapshot: string;
    productSkuSnapshot: string;
    quantity: Prisma.Decimal;
  }>;
  orderDate: Date;
  orderedAt: Date | null;
  organizationId: string;
  receivedAt: Date | null;
  reference: string;
  status: SafePurchaseOrder["status"];
  supplierId: string;
  updatedAt: Date;
}): SafePurchaseOrder {
  return {
    branchId: order.branchId,
    cancelledAt: iso(order.cancelledAt),
    createdAt: order.createdAt.toISOString(),
    currency: order.currency as "THB",
    expectedDate:
      order.expectedDate === null ? null : dateOnly(order.expectedDate),
    expectedTotal: order.expectedTotal.toFixed(4),
    id: order.id,
    items: order.items.map(safeItem),
    orderDate: dateOnly(order.orderDate),
    orderedAt: iso(order.orderedAt),
    organizationId: order.organizationId,
    receivedAt: iso(order.receivedAt),
    reference: order.reference,
    status: order.status,
    supplierId: order.supplierId,
    updatedAt: order.updatedAt.toISOString(),
  };
}

function safePurchaseOrderSummary(
  order: Omit<SafePurchaseOrder, "items"> & { expectedTotal: string },
): SafePurchaseOrderSummary {
  return order;
}

function nextUpdatedAt(expectedUpdatedAt: Date, currentTime: Date): Date {
  return new Date(
    Math.max(expectedUpdatedAt.getTime() + 1, currentTime.getTime()),
  );
}

function filterHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type Cursor = {
  createdAt: string;
  filterHash: string;
  id: string;
  version: 1;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MILLISECOND_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  expectedFilterHash: string,
): Cursor | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const cursor = parsed as Partial<Cursor>;
    if (
      cursor.version !== 1 ||
      typeof cursor.createdAt !== "string" ||
      !MILLISECOND_UTC_PATTERN.test(cursor.createdAt) ||
      Number.isNaN(Date.parse(cursor.createdAt)) ||
      typeof cursor.id !== "string" ||
      !UUID_PATTERN.test(cursor.id) ||
      cursor.filterHash !== expectedFilterHash
    ) {
      return null;
    }
    return cursor as Cursor;
  } catch {
    return null;
  }
}

async function authorize(
  transaction: Transaction,
  input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    permission:
      | typeof PERMISSIONS.PURCHASE_ORDER_CREATE_EDIT
      | typeof PERMISSIONS.PURCHASE_ORDER_VIEW;
  },
): Promise<
  | { kind: "allowed"; membershipId: string }
  | AuthorizationFailure
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
  } satisfies ResolvedAuthorizationState);
  const scope = createTrustedBranchScope({
    branchId: branch.id,
    branchOrganizationId: branch.organizationId,
    organizationId: input.organizationId,
  });
  if (
    context === null ||
    scope === null ||
    !can(context, input.permission, scope)
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

async function activeSupplier(
  transaction: Transaction,
  organizationId: string,
  supplierId: string,
): Promise<"active" | "inactive" | "not_found"> {
  const rows = await transaction.$queryRaw<
    Array<{ status: "ACTIVE" | "INACTIVE" }>
  >(Prisma.sql`
    SELECT "status"::text AS "status"
    FROM "suppliers"
    WHERE "id" = ${supplierId}::uuid
      AND "organization_id" = ${organizationId}::uuid
    FOR SHARE
  `);
  const supplier = rows[0];
  if (supplier === undefined) return "not_found";
  return supplier.status === "ACTIVE" ? "active" : "inactive";
}

type ProductSnapshot = {
  id: string;
  name: string;
  sku: string;
  status: "ACTIVE" | "INACTIVE";
  unit: PurchaseOrderUnit;
};

async function lockedProducts(
  transaction: Transaction,
  organizationId: string,
  productIds: readonly string[],
): Promise<ProductSnapshot[]> {
  const products: ProductSnapshot[] = [];
  for (const productId of [...productIds].sort()) {
    const rows = await transaction.$queryRaw<ProductSnapshot[]>(Prisma.sql`
      SELECT "id", "name", "sku", "status"::text AS "status", "unit"::text AS "unit"
      FROM "products"
      WHERE "id" = ${productId}::uuid
        AND "organization_id" = ${organizationId}::uuid
      FOR SHARE
    `);
    const product = rows[0];
    if (product !== undefined) products.push(product);
  }
  return products;
}

type PreparedLine = {
  expectedUnitCost: Prisma.Decimal;
  productId: string;
  productNameSnapshot: string;
  productSkuSnapshot: string;
  quantity: Prisma.Decimal;
};

async function prepareLines(
  transaction: Transaction,
  organizationId: string,
  lines: readonly {
    expectedUnitCost: string;
    productId: string;
    quantity: string;
  }[],
): Promise<PreparedLine[] | LifecycleFailure | { kind: "product_not_found" }> {
  const uniqueIds = new Set<string>();
  for (const line of lines) {
    if (uniqueIds.has(line.productId)) return { kind: "duplicate_product" };
    uniqueIds.add(line.productId);
  }
  const products = await lockedProducts(transaction, organizationId, [
    ...uniqueIds,
  ]);
  if (products.length !== uniqueIds.size) return { kind: "product_not_found" };
  const byId = new Map(products.map((product) => [product.id, product]));
  const prepared: PreparedLine[] = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (product === undefined) return { kind: "product_not_found" };
    if (product.status !== "ACTIVE") return { kind: "product_inactive" };
    const quantity = parsePurchaseOrderQuantity(line.quantity, product.unit);
    if (quantity === null) return { kind: "invalid_quantity" };
    const expectedUnitCost = parseExpectedUnitCost(line.expectedUnitCost);
    if (expectedUnitCost === null) return { kind: "invalid_cost" };
    prepared.push({
      expectedUnitCost,
      productId: product.id,
      productNameSnapshot: product.name,
      productSkuSnapshot: product.sku,
      quantity,
    });
  }
  return prepared;
}

function isPreparedLines(
  value: PreparedLine[] | LifecycleFailure | { kind: "product_not_found" },
): value is PreparedLine[] {
  return Array.isArray(value);
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
    target === "purchase_orders_organization_id_reference_key" ||
    (Array.isArray(target) && target.includes("reference"))
  );
}

function safeSummary(order: {
  branchId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  currency: string;
  expectedDate: Date | null;
  expectedTotal: Prisma.Decimal;
  id: string;
  orderDate: Date;
  orderedAt: Date | null;
  organizationId: string;
  receivedAt: Date | null;
  reference: string;
  status: SafePurchaseOrder["status"];
  supplierId: string;
  updatedAt: Date;
}): SafePurchaseOrderSummary {
  return safePurchaseOrderSummary({
    branchId: order.branchId,
    cancelledAt: iso(order.cancelledAt),
    createdAt: order.createdAt.toISOString(),
    currency: order.currency as "THB",
    expectedDate:
      order.expectedDate === null ? null : dateOnly(order.expectedDate),
    expectedTotal: order.expectedTotal.toFixed(4),
    id: order.id,
    orderDate: dateOnly(order.orderDate),
    orderedAt: iso(order.orderedAt),
    organizationId: order.organizationId,
    receivedAt: iso(order.receivedAt),
    reference: order.reference,
    status: order.status,
    supplierId: order.supplierId,
    updatedAt: order.updatedAt.toISOString(),
  });
}

export function createPrismaPurchaseOrderRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): PurchaseOrderRepository {
  return {
    async createPurchaseOrder(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(async (transaction) => {
            const access = await authorize(transaction, {
              actorUserId: input.actorUserId,
              branchId: input.branchId,
              organizationId: input.organizationId,
              permission: PERMISSIONS.PURCHASE_ORDER_CREATE_EDIT,
            });
            if (access.kind !== "allowed") return access;
            const supplier = await activeSupplier(
              transaction,
              input.organizationId,
              input.purchaseOrder.supplierId,
            );
            if (supplier === "not_found") return { kind: "supplier_not_found" };
            if (supplier === "inactive") return { kind: "supplier_inactive" };
            const lines = await prepareLines(
              transaction,
              input.organizationId,
              input.purchaseOrder.items,
            );
            if (!isPreparedLines(lines)) return lines;
            const purchaseOrder = await transaction.purchaseOrder.create({
              data: {
                branchId: input.branchId,
                createdByMembershipId: access.membershipId,
                createdByUserId: input.actorUserId,
                expectedDate: input.purchaseOrder.expectedDate,
                expectedTotal: expectedPurchaseOrderTotal(lines),
                items: { create: lines },
                orderDate: input.purchaseOrder.orderDate,
                organizationId: input.organizationId,
                reference: `PO-${randomUUID()}`,
                supplierId: input.purchaseOrder.supplierId,
              },
              select: purchaseOrderSelection,
            });
            return {
              kind: "success",
              purchaseOrder: safePurchaseOrder(purchaseOrder),
            };
          });
        } catch (error: unknown) {
          if (referenceConflict(error)) continue;
          throw error;
        }
      }
      return { kind: "reference_conflict" };
    },

    async getPurchaseOrder(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          organizationId: input.organizationId,
          permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
        });
        if (access.kind !== "allowed") {
          return access.kind === "branch_inactive"
            ? { kind: "forbidden" }
            : access;
        }
        const purchaseOrder = await transaction.purchaseOrder.findFirst({
          where: {
            branchId: input.branchId,
            id: input.purchaseOrderId,
            organizationId: input.organizationId,
          },
          select: purchaseOrderSelection,
        });
        return purchaseOrder === null
          ? { kind: "not_found" as const }
          : {
              kind: "success" as const,
              purchaseOrder: safePurchaseOrder(purchaseOrder),
            };
      });
    },

    async listPurchaseOrders(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          organizationId: input.organizationId,
          permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
        });
        if (access.kind !== "allowed") {
          return access.kind === "branch_inactive"
            ? { kind: "forbidden" }
            : access;
        }
        const hash = filterHash({
          branchId: input.branchId,
          orderDateFrom: input.query.orderDateFrom?.toISOString() ?? null,
          orderDateTo: input.query.orderDateTo?.toISOString() ?? null,
          organizationId: input.organizationId,
          resource: "purchase-order",
          status: input.query.status,
          supplierId: input.query.supplierId ?? null,
        });
        const cursor =
          input.query.cursor === undefined
            ? null
            : decodeCursor(input.query.cursor, hash);
        if (input.query.cursor !== undefined && cursor === null) {
          return { kind: "invalid_cursor" as const };
        }
        const filters: Prisma.PurchaseOrderWhereInput[] = [
          { branchId: input.branchId, organizationId: input.organizationId },
        ];
        if (input.query.status !== "all")
          filters.push({ status: input.query.status });
        if (input.query.supplierId !== undefined) {
          filters.push({ supplierId: input.query.supplierId });
        }
        if (input.query.orderDateFrom !== undefined) {
          filters.push({ orderDate: { gte: input.query.orderDateFrom } });
        }
        if (input.query.orderDateTo !== undefined) {
          filters.push({ orderDate: { lte: input.query.orderDateTo } });
        }
        if (cursor !== null) {
          const createdAt = new Date(cursor.createdAt);
          filters.push({
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: cursor.id } },
            ],
          });
        }
        const rows = await transaction.purchaseOrder.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: purchaseOrderSummarySelection,
          take: input.query.limit + 1,
          where: { AND: filters },
        });
        const hasMore = rows.length > input.query.limit;
        const page = hasMore ? rows.slice(0, input.query.limit) : rows;
        const last = page.at(-1);
        return {
          kind: "success" as const,
          nextCursor:
            hasMore && last !== undefined
              ? encodeCursor({
                  createdAt: last.createdAt.toISOString(),
                  filterHash: hash,
                  id: last.id,
                  version: 1,
                })
              : null,
          purchaseOrders: page.map(safeSummary),
        };
      });
    },

    async updatePurchaseOrder(input) {
      return prisma.$transaction(async (transaction) => {
        if (
          !(await lockPurchaseOrder(
            transaction,
            input.organizationId,
            input.purchaseOrderId,
          ))
        ) {
          return { kind: "not_found" as const };
        }
        const current = await transaction.purchaseOrder.findFirstOrThrow({
          where: {
            id: input.purchaseOrderId,
            organizationId: input.organizationId,
          },
          select: purchaseOrderSelection,
        });
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          branchId: current.branchId,
          organizationId: input.organizationId,
          permission: PERMISSIONS.PURCHASE_ORDER_CREATE_EDIT,
        });
        if (access.kind !== "allowed") return access;
        if (input.branchId !== current.branchId) return { kind: "not_found" };
        if (
          current.updatedAt.getTime() !==
          input.purchaseOrder.expectedUpdatedAt.getTime()
        ) {
          return { kind: "stale" };
        }
        if (input.purchaseOrder.status !== undefined) {
          if (input.purchaseOrder.status === "ORDERED") {
            if (current.status !== "DRAFT")
              return { kind: "invalid_transition" };
            const supplier = await activeSupplier(
              transaction,
              input.organizationId,
              current.supplierId,
            );
            if (supplier === "not_found") return { kind: "supplier_not_found" };
            if (supplier === "inactive") return { kind: "supplier_inactive" };
            const lines = await prepareLines(
              transaction,
              input.organizationId,
              current.items.map((item) => ({
                expectedUnitCost: item.expectedUnitCost.toFixed(4),
                productId: item.productId,
                quantity: item.quantity.toFixed(4),
              })),
            );
            if (!isPreparedLines(lines)) return lines;
            const updated = await transaction.purchaseOrder.updateMany({
              data: {
                expectedTotal: expectedPurchaseOrderTotal(lines),
                orderedAt: now(),
                status: "ORDERED",
                updatedAt: nextUpdatedAt(
                  input.purchaseOrder.expectedUpdatedAt,
                  now(),
                ),
              },
              where: {
                id: current.id,
                organizationId: input.organizationId,
                status: "DRAFT",
                updatedAt: input.purchaseOrder.expectedUpdatedAt,
              },
            });
            if (updated.count === 0) return { kind: "stale" };
            for (const line of lines) {
              await transaction.purchaseOrderItem.updateMany({
                data: {
                  productNameSnapshot: line.productNameSnapshot,
                  productSkuSnapshot: line.productSkuSnapshot,
                },
                where: {
                  productId: line.productId,
                  purchaseOrderId: current.id,
                },
              });
            }
          } else {
            if (current.status !== "DRAFT" && current.status !== "ORDERED") {
              return { kind: "invalid_transition" };
            }
            const updated = await transaction.purchaseOrder.updateMany({
              data: {
                cancelledAt: now(),
                status: "CANCELLED",
                updatedAt: nextUpdatedAt(
                  input.purchaseOrder.expectedUpdatedAt,
                  now(),
                ),
              },
              where: {
                id: current.id,
                organizationId: input.organizationId,
                status: current.status,
                updatedAt: input.purchaseOrder.expectedUpdatedAt,
              },
            });
            if (updated.count === 0) return { kind: "stale" };
          }
        } else {
          if (current.status !== "DRAFT") return { kind: "invalid_transition" };
          const targetBranchId =
            input.purchaseOrder.branchId ?? current.branchId;
          if (targetBranchId !== current.branchId) {
            const targetAccess = await authorize(transaction, {
              actorUserId: input.actorUserId,
              branchId: targetBranchId,
              organizationId: input.organizationId,
              permission: PERMISSIONS.PURCHASE_ORDER_CREATE_EDIT,
            });
            if (targetAccess.kind !== "allowed") return targetAccess;
          }
          const supplierId =
            input.purchaseOrder.supplierId ?? current.supplierId;
          const supplier = await activeSupplier(
            transaction,
            input.organizationId,
            supplierId,
          );
          if (supplier === "not_found") return { kind: "supplier_not_found" };
          if (supplier === "inactive") return { kind: "supplier_inactive" };
          const lines = await prepareLines(
            transaction,
            input.organizationId,
            input.purchaseOrder.items ??
              current.items.map((item) => ({
                expectedUnitCost: item.expectedUnitCost.toFixed(4),
                productId: item.productId,
                quantity: item.quantity.toFixed(4),
              })),
          );
          if (!isPreparedLines(lines)) return lines;
          const updated = await transaction.purchaseOrder.updateMany({
            data: {
              branchId: targetBranchId,
              expectedDate:
                input.purchaseOrder.expectedDate === undefined
                  ? current.expectedDate
                  : input.purchaseOrder.expectedDate,
              expectedTotal: expectedPurchaseOrderTotal(lines),
              orderDate: input.purchaseOrder.orderDate ?? current.orderDate,
              supplierId,
              updatedAt: nextUpdatedAt(
                input.purchaseOrder.expectedUpdatedAt,
                now(),
              ),
            },
            where: {
              id: current.id,
              organizationId: input.organizationId,
              status: "DRAFT",
              updatedAt: input.purchaseOrder.expectedUpdatedAt,
            },
          });
          if (updated.count === 0) return { kind: "stale" };
          if (input.purchaseOrder.items !== undefined) {
            await transaction.purchaseOrderItem.deleteMany({
              where: { purchaseOrderId: current.id },
            });
            await transaction.purchaseOrderItem.createMany({
              data: lines.map((line) => ({
                ...line,
                organizationId: input.organizationId,
                purchaseOrderId: current.id,
              })),
            });
          }
        }
        const purchaseOrder = await transaction.purchaseOrder.findFirstOrThrow({
          where: { id: current.id, organizationId: input.organizationId },
          select: purchaseOrderSelection,
        });
        return {
          kind: "success",
          purchaseOrder: safePurchaseOrder(purchaseOrder),
        };
      });
    },
  };
}
