import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import {
  can,
  createTrustedAuthorizationContext,
  createTrustedBranchScope,
  PERMISSIONS,
  type ResolvedAuthorizationState,
  type TrustedAuthorizationContext,
} from "../identity/authorization-policy.ts";
import type {
  InventoryAdjustmentInput,
  InventoryHistoryQuery,
  InventoryListQuery,
} from "./inventory-schemas.ts";
import {
  canonicalQuantity,
  inventoryQuantityFitsStorage,
  parseInventoryDelta,
} from "./inventory-values.ts";

export interface SafeInventoryProduct {
  categoryId: string | null;
  id: string;
  name: string;
  sku: string;
  status: "ACTIVE" | "INACTIVE";
  unit: "EA" | "PACK" | "BOX" | "KG" | "G" | "L" | "ML" | "M" | "CM";
}

export interface SafeInventoryBalance {
  exists: boolean;
  quantity: string;
  updatedAt: string | null;
}

export interface SafeInventoryItem {
  balance: SafeInventoryBalance;
  product: SafeInventoryProduct;
}

export interface SafeInventoryTransaction {
  actor: { displayName: string | null; id: string };
  delta: string;
  id: string;
  note: string | null;
  occurredAt: string;
  reason: string;
  source: string;
}

export interface SafeInventoryAdjustment {
  balance: { quantity: string };
  transaction: Omit<SafeInventoryTransaction, "actor">;
}

type AuthorizationFailure = { kind: "forbidden" };

export type InventoryListOutcome =
  | {
      inventory: SafeInventoryItem[];
      kind: "success";
      nextCursor: string | null;
    }
  | AuthorizationFailure
  | { kind: "invalid_cursor" };

export type InventoryDetailOutcome =
  | { inventory: SafeInventoryItem; kind: "success" }
  | AuthorizationFailure
  | { kind: "not_found" };

export type InventoryHistoryOutcome =
  | {
      kind: "success";
      nextCursor: string | null;
      transactions: SafeInventoryTransaction[];
    }
  | AuthorizationFailure
  | { kind: "not_found" }
  | { kind: "invalid_cursor" };

export type InventoryAdjustmentOutcome =
  | { adjustment: SafeInventoryAdjustment; kind: "success" | "replay" }
  | AuthorizationFailure
  | { kind: "not_found" }
  | { kind: "branch_inactive" }
  | { kind: "product_inactive" }
  | { kind: "invalid_quantity" }
  | { kind: "insufficient_stock" }
  | { kind: "idempotency_conflict" };

export interface InventoryRepository {
  adjust(input: {
    actorUserId: string;
    adjustment: InventoryAdjustmentInput;
    branchId: string;
    idempotencyKey: string;
    organizationId: string;
  }): Promise<InventoryAdjustmentOutcome>;
  getBalance(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    productId: string;
  }): Promise<InventoryDetailOutcome>;
  listBalances(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    query: InventoryListQuery;
  }): Promise<InventoryListOutcome>;
  listHistory(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    productId: string;
    query: InventoryHistoryQuery;
  }): Promise<InventoryHistoryOutcome>;
}

type Transaction = Prisma.TransactionClient;

async function authorize(
  transaction: Transaction,
  input: { actorUserId: string; branchId: string; organizationId: string },
): Promise<{ kind: "allowed" } | AuthorizationFailure> {
  const membership = await transaction.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
      },
    },
    select: {
      branchAssignments: {
        select: {
          branchId: true,
          organizationId: true,
          status: true,
          userId: true,
        },
      },
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
  const state: ResolvedAuthorizationState = {
    actor: membership.user,
    branchAssignments: membership.branchAssignments,
    membership: {
      organizationId: membership.organizationId,
      role: membership.role,
      status: membership.status,
      userId: membership.userId,
    },
  };
  const context: TrustedAuthorizationContext | null =
    createTrustedAuthorizationContext(state);
  const branch = await transaction.branch.findFirst({
    where: {
      id: input.branchId,
      organizationId: input.organizationId,
    },
    select: { id: true, organizationId: true },
  });
  const scope =
    branch === null
      ? null
      : createTrustedBranchScope({
          branchId: branch.id,
          branchOrganizationId: branch.organizationId,
          organizationId: input.organizationId,
        });
  if (
    context === null ||
    context.actorStatus !== "ACTIVE" ||
    context.membershipStatus !== "ACTIVE" ||
    !can(context, PERMISSIONS.INVENTORY_VIEW, scope)
  ) {
    return { kind: "forbidden" };
  }
  return { kind: "allowed" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type AdjustmentAuthorization = {
  actorMembershipId: string;
  context: TrustedAuthorizationContext;
};

async function lockAdjustmentAuthorization(
  transaction: Transaction,
  input: { actorUserId: string; branchId: string; organizationId: string },
): Promise<
  | { kind: "allowed"; authorization: AdjustmentAuthorization }
  | AuthorizationFailure
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
  if (organizations.length !== 1) return { kind: "forbidden" };

  const users = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "users"
    WHERE "id" = ${input.actorUserId}::uuid
      AND "status" = 'ACTIVE'
    FOR SHARE
  `);
  if (users.length !== 1) return { kind: "forbidden" };

  const branches = await transaction.$queryRaw<
    Array<{
      id: string;
      organizationId: string;
      status: "ACTIVE" | "INACTIVE";
    }>
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
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
      },
    },
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
  });
  if (membership === null) return { kind: "forbidden" };
  const context = createTrustedAuthorizationContext({
    actor: { id: input.actorUserId, status: "ACTIVE" },
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
  if (!can(context, PERMISSIONS.INVENTORY_ADJUST, scope) || context === null) {
    return { kind: "forbidden" };
  }
  if (branch.status !== "ACTIVE") return { kind: "branch_inactive" };
  return {
    authorization: { actorMembershipId: membership.id, context },
    kind: "allowed",
  };
}

type AdvisoryLockNamespace = "balance" | "idempotency";

const ADVISORY_LOCK_MAGNITUDE_MASK = (1n << 63n) - 1n;

function advisoryLockKey(
  namespace: AdvisoryLockNamespace,
  identity: string,
): bigint {
  const digest = createHash("sha256")
    .update(`stockwise-inventory-${namespace}\0${identity}`, "utf8")
    .digest();
  const magnitude = digest.readBigUInt64BE(0) & ADVISORY_LOCK_MAGNITUDE_MASK;

  // PostgreSQL exposes one signed 64-bit advisory-lock key space. Keeping the
  // namespaces on opposite sides of zero prevents cross-class lock aliasing.
  return namespace === "idempotency" ? magnitude : -(magnitude + 1n);
}

export function inventoryBalanceAdvisoryLockKey(
  branchId: string,
  productId: string,
): bigint {
  return advisoryLockKey("balance", `${branchId}:${productId}`);
}

export function inventoryIdempotencyAdvisoryLockKey(
  organizationId: string,
  keyHash: string,
): bigint {
  return advisoryLockKey("idempotency", `${organizationId}:${keyHash}`);
}

async function advisoryLock(
  transaction: Transaction,
  key: bigint,
): Promise<void> {
  await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    SELECT 1::integer AS "locked"
    FROM (
      SELECT pg_advisory_xact_lock(${key.toString()}::bigint)
    ) AS "inventory_lock"
  `);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function adjustmentRequestHash(input: {
  actorUserId: string;
  branchId: string;
  delta: string;
  note: string | null;
  organizationId: string;
  productId: string;
  reason: string;
}): string {
  return sha256(
    JSON.stringify({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      delta: input.delta,
      note: input.note,
      operation: "MANUAL_ADJUSTMENT",
      organizationId: input.organizationId,
      productId: input.productId,
      reason: input.reason,
    }),
  );
}

function nextOccurredAt(now: Date, latest: Date | undefined): Date {
  return new Date(
    Math.max(now.getTime(), latest === undefined ? 0 : latest.getTime() + 1),
  );
}

async function replayAdjustment(
  transaction: Transaction,
  row: {
    adjustmentReason: string;
    canonicalRequestHash: string;
    delta: Prisma.Decimal;
    id: string;
    note: string | null;
    occurredAt: Date;
    source: string;
  },
  input: { branchId: string; organizationId: string; productId: string },
): Promise<SafeInventoryAdjustment> {
  await advisoryLock(
    transaction,
    inventoryBalanceAdvisoryLockKey(input.branchId, input.productId),
  );
  const sum = await transaction.inventoryTransaction.aggregate({
    _sum: { delta: true },
    where: {
      branchId: input.branchId,
      occurredAt: { lte: row.occurredAt },
      organizationId: input.organizationId,
      productId: input.productId,
    },
  });
  return {
    balance: {
      quantity: canonicalQuantity(sum._sum.delta ?? new Prisma.Decimal(0)),
    },
    transaction: {
      delta: canonicalQuantity(row.delta),
      id: row.id,
      note: row.note,
      occurredAt: row.occurredAt.toISOString(),
      reason: row.adjustmentReason,
      source: row.source,
    },
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function filterHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type BalanceCursor = {
  createdAt: string;
  filterHash: string;
  id: string;
  version: 1;
};
type HistoryCursor = {
  filterHash: string;
  id: string;
  occurredAt: string;
  version: 1;
};

function encodeCursor(cursor: BalanceCursor | HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor<Field extends "createdAt" | "occurredAt">(
  value: string,
  expectedFilterHash: string,
  field: Field,
): (Field extends "createdAt" ? BalanceCursor : HistoryCursor) | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.filterHash !== expectedFilterHash ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      typeof parsed[field] !== "string" ||
      !UTC_PATTERN.test(parsed[field]) ||
      Number.isNaN(Date.parse(parsed[field]))
    ) {
      return null;
    }
    return parsed as Field extends "createdAt" ? BalanceCursor : HistoryCursor;
  } catch {
    return null;
  }
}

function safeInventoryItem(product: {
  categoryId: string | null;
  id: string;
  inventoryBalances: Array<{ quantity: Prisma.Decimal; updatedAt: Date }>;
  name: string;
  sku: string;
  status: "ACTIVE" | "INACTIVE";
  unit: SafeInventoryProduct["unit"];
}): SafeInventoryItem {
  const balance = product.inventoryBalances[0];
  return {
    balance:
      balance === undefined
        ? { exists: false, quantity: "0", updatedAt: null }
        : {
            exists: true,
            quantity: canonicalQuantity(balance.quantity),
            updatedAt: balance.updatedAt.toISOString(),
          },
    product: {
      categoryId: product.categoryId,
      id: product.id,
      name: product.name,
      sku: product.sku,
      status: product.status,
      unit: product.unit,
    },
  };
}

function productSelect(branchId: string) {
  return {
    categoryId: true,
    createdAt: true,
    id: true,
    inventoryBalances: {
      where: { branchId },
      select: { quantity: true, updatedAt: true },
    },
    name: true,
    sku: true,
    status: true,
    unit: true,
  } as const;
}

export function createPrismaInventoryRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): InventoryRepository {
  return {
    async adjust(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await lockAdjustmentAuthorization(transaction, input);
        if (access.kind !== "allowed") return access;

        const products = await transaction.$queryRaw<
          Array<{
            id: string;
            status: "ACTIVE" | "INACTIVE";
            unit: SafeInventoryProduct["unit"];
          }>
        >(Prisma.sql`
          SELECT "id", "status"::text AS "status", "unit"::text AS "unit"
          FROM "products"
          WHERE "id" = ${input.adjustment.productId}::uuid
            AND "organization_id" = ${input.organizationId}::uuid
          FOR SHARE
        `);
        const product = products[0];
        if (product === undefined) return { kind: "not_found" } as const;
        if (product.status !== "ACTIVE")
          return { kind: "product_inactive" } as const;

        const delta = parseInventoryDelta(input.adjustment.delta, product.unit);
        if (delta === null) return { kind: "invalid_quantity" } as const;
        const canonicalDelta = canonicalQuantity(delta);
        const keyHash = sha256(input.idempotencyKey);
        const requestHash = adjustmentRequestHash({
          actorUserId: access.authorization.context.actorId,
          branchId: input.branchId,
          delta: canonicalDelta,
          note: input.adjustment.note,
          organizationId: input.organizationId,
          productId: product.id,
          reason: input.adjustment.reason,
        });

        await advisoryLock(
          transaction,
          inventoryIdempotencyAdvisoryLockKey(input.organizationId, keyHash),
        );
        const prior = await transaction.inventoryTransaction.findUnique({
          where: {
            organizationId_idempotencyKeyHash: {
              idempotencyKeyHash: keyHash,
              organizationId: input.organizationId,
            },
          },
          select: {
            adjustmentReason: true,
            branchId: true,
            canonicalRequestHash: true,
            delta: true,
            id: true,
            note: true,
            occurredAt: true,
            productId: true,
            source: true,
          },
        });
        if (prior !== null) {
          if (prior.canonicalRequestHash !== requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          return {
            adjustment: await replayAdjustment(transaction, prior, {
              branchId: prior.branchId,
              organizationId: input.organizationId,
              productId: prior.productId,
            }),
            kind: "replay",
          } as const;
        }

        await advisoryLock(
          transaction,
          inventoryBalanceAdvisoryLockKey(input.branchId, product.id),
        );
        const balances = await transaction.$queryRaw<
          Array<{ id: string; quantity: Prisma.Decimal }>
        >(Prisma.sql`
          SELECT "id", "quantity"
          FROM "inventory_balances"
          WHERE "branch_id" = ${input.branchId}::uuid
            AND "product_id" = ${product.id}::uuid
            AND "organization_id" = ${input.organizationId}::uuid
          FOR UPDATE
        `);
        const current = balances[0];
        const resultingQuantity = (
          current?.quantity ?? new Prisma.Decimal(0)
        ).plus(delta);
        if (resultingQuantity.isNegative()) {
          return { kind: "insufficient_stock" } as const;
        }
        if (!inventoryQuantityFitsStorage(resultingQuantity)) {
          return { kind: "invalid_quantity" } as const;
        }

        if (current === undefined) {
          await transaction.inventoryBalance.create({
            data: {
              branchId: input.branchId,
              organizationId: input.organizationId,
              productId: product.id,
              quantity: resultingQuantity,
            },
          });
        } else {
          await transaction.inventoryBalance.update({
            data: { quantity: resultingQuantity },
            where: { id: current.id },
          });
        }

        const latest = await transaction.inventoryTransaction.findFirst({
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: { occurredAt: true },
          where: {
            branchId: input.branchId,
            organizationId: input.organizationId,
            productId: product.id,
          },
        });
        const movement = await transaction.inventoryTransaction.create({
          data: {
            actorMembershipId: access.authorization.actorMembershipId,
            actorUserId: access.authorization.context.actorId,
            adjustmentReason: input.adjustment.reason,
            branchId: input.branchId,
            canonicalRequestHash: requestHash,
            delta,
            idempotencyKeyHash: keyHash,
            note: input.adjustment.note,
            occurredAt: nextOccurredAt(now(), latest?.occurredAt),
            organizationId: input.organizationId,
            productId: product.id,
            source: "MANUAL_ADJUSTMENT",
          },
          select: {
            adjustmentReason: true,
            delta: true,
            id: true,
            note: true,
            occurredAt: true,
            source: true,
          },
        });
        return {
          adjustment: {
            balance: { quantity: canonicalQuantity(resultingQuantity) },
            transaction: {
              delta: canonicalQuantity(movement.delta),
              id: movement.id,
              note: movement.note,
              occurredAt: movement.occurredAt.toISOString(),
              reason: movement.adjustmentReason,
              source: movement.source,
            },
          },
          kind: "success",
        } as const;
      });
    },
    async listBalances(input) {
      return prisma.$transaction(async (transaction) => {
        if ((await authorize(transaction, input)).kind !== "allowed") {
          return { kind: "forbidden" } as const;
        }
        const hash = filterHash({
          branchId: input.branchId,
          categoryId: input.query.categoryId ?? null,
          organizationId: input.organizationId,
          status: input.query.status,
        });
        const cursor =
          input.query.cursor === undefined
            ? null
            : decodeCursor(input.query.cursor, hash, "createdAt");
        if (input.query.cursor !== undefined && cursor === null) {
          return { kind: "invalid_cursor" } as const;
        }
        const filters: Prisma.ProductWhereInput[] = [
          { organizationId: input.organizationId },
        ];
        if (input.query.status !== "ALL")
          filters.push({ status: input.query.status });
        if (input.query.categoryId === "uncategorized")
          filters.push({ categoryId: null });
        else if (input.query.categoryId !== undefined)
          filters.push({ categoryId: input.query.categoryId });
        if (cursor !== null) {
          filters.push({
            OR: [
              { createdAt: { gt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
            ],
          });
        }
        const rows = await transaction.product.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: productSelect(input.branchId),
          take: input.query.limit + 1,
          where: { AND: filters },
        });
        const hasMore = rows.length > input.query.limit;
        const page = hasMore ? rows.slice(0, input.query.limit) : rows;
        const last = page.at(-1);
        return {
          inventory: page.map(safeInventoryItem),
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
        };
      });
    },

    async getBalance(input) {
      return prisma.$transaction(async (transaction) => {
        if ((await authorize(transaction, input)).kind !== "allowed") {
          return { kind: "forbidden" } as const;
        }
        const product = await transaction.product.findFirst({
          where: { id: input.productId, organizationId: input.organizationId },
          select: productSelect(input.branchId),
        });
        return product === null
          ? { kind: "not_found" as const }
          : { inventory: safeInventoryItem(product), kind: "success" as const };
      });
    },

    async listHistory(input) {
      return prisma.$transaction(async (transaction) => {
        if ((await authorize(transaction, input)).kind !== "allowed") {
          return { kind: "forbidden" } as const;
        }
        const product = await transaction.product.findFirst({
          where: { id: input.productId, organizationId: input.organizationId },
          select: { id: true },
        });
        if (product === null) return { kind: "not_found" } as const;
        const hash = filterHash({
          branchId: input.branchId,
          occurredAfter: input.query.occurredAfter?.toISOString() ?? null,
          occurredBefore: input.query.occurredBefore?.toISOString() ?? null,
          organizationId: input.organizationId,
          productId: input.productId,
          source: input.query.source ?? null,
        });
        const cursor =
          input.query.cursor === undefined
            ? null
            : decodeCursor(input.query.cursor, hash, "occurredAt");
        if (input.query.cursor !== undefined && cursor === null) {
          return { kind: "invalid_cursor" } as const;
        }
        const filters: Prisma.InventoryTransactionWhereInput[] = [
          {
            branchId: input.branchId,
            organizationId: input.organizationId,
            productId: input.productId,
          },
        ];
        if (input.query.source !== undefined)
          filters.push({ source: input.query.source });
        if (input.query.occurredAfter !== undefined) {
          filters.push({ occurredAt: { gte: input.query.occurredAfter } });
        }
        if (input.query.occurredBefore !== undefined) {
          filters.push({ occurredAt: { lte: input.query.occurredBefore } });
        }
        if (cursor !== null) {
          filters.push({
            OR: [
              { occurredAt: { gt: new Date(cursor.occurredAt) } },
              {
                occurredAt: new Date(cursor.occurredAt),
                id: { gt: cursor.id },
              },
            ],
          });
        }
        const rows = await transaction.inventoryTransaction.findMany({
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: {
            actorUser: { select: { displayName: true, id: true } },
            adjustmentReason: true,
            delta: true,
            id: true,
            note: true,
            occurredAt: true,
            source: true,
          },
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
                  filterHash: hash,
                  id: last.id,
                  occurredAt: last.occurredAt.toISOString(),
                  version: 1,
                })
              : null,
          transactions: page.map((row) => ({
            actor: row.actorUser,
            delta: canonicalQuantity(row.delta),
            id: row.id,
            note: row.note,
            occurredAt: row.occurredAt.toISOString(),
            reason: row.adjustmentReason,
            source: row.source,
          })),
        };
      });
    },
  };
}
