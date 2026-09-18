import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import {
  can,
  createTrustedAuthorizationContext,
  createTrustedBranchScope,
  createTrustedOrganizationScope,
  PERMISSIONS,
} from "../identity/authorization-policy.ts";
import type {
  PosProductSearchQuery,
  SalesVatProfileUpdateInput,
} from "./sales-schemas.ts";

type Transaction = Prisma.TransactionClient;

export interface SafeSalesVatProfile {
  salesVatRate: string | null;
  salesVatStatus: "UNCONFIGURED" | "NOT_REGISTERED" | "REGISTERED";
  updatedAt: string;
}

export interface SafePosProduct {
  available: boolean;
  barcode: string | null;
  basePrice: string;
  id: string;
  name: string;
  sku: string;
  unit: string;
}

type AuthorizationFailure = { kind: "forbidden" };

export type SalesVatProfileOutcome =
  { kind: "success"; profile: SafeSalesVatProfile } | AuthorizationFailure;

export type SalesVatProfileUpdateOutcome =
  SalesVatProfileOutcome | { kind: "invalid_profile" } | { kind: "stale" };

export type PosProductSearchOutcome =
  | {
      kind: "success";
      nextCursor: string | null;
      products: SafePosProduct[];
    }
  | AuthorizationFailure
  | { kind: "branch_inactive" }
  | { kind: "invalid_cursor" };

export interface SalesApiRepository {
  getSalesVatProfile(input: {
    actorUserId: string;
    organizationId: string;
  }): Promise<SalesVatProfileOutcome>;
  searchPosProducts(input: {
    actorUserId: string;
    branchId: string;
    organizationId: string;
    query: PosProductSearchQuery;
  }): Promise<PosProductSearchOutcome>;
  updateSalesVatProfile(input: {
    actorUserId: string;
    organizationId: string;
    profile: SalesVatProfileUpdateInput;
  }): Promise<SalesVatProfileUpdateOutcome>;
}

interface CursorValue {
  filterHash: string;
  id: string;
  name: string;
  version: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filterHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string,
  expectedFilterHash: string,
): CursorValue | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) return null;
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.filterHash !== "string" ||
      value.filterHash !== expectedFilterHash ||
      typeof value.id !== "string" ||
      typeof value.name !== "string"
    ) {
      return null;
    }
    return {
      filterHash: value.filterHash,
      id: value.id,
      name: value.name,
      version: 1,
    };
  } catch {
    return null;
  }
}

function safeProfile(input: {
  salesVatRate: Prisma.Decimal | null;
  salesVatStatus: "UNCONFIGURED" | "NOT_REGISTERED" | "REGISTERED";
  updatedAt: Date;
}): SafeSalesVatProfile {
  return {
    salesVatRate: input.salesVatRate?.toString() ?? null,
    salesVatStatus: input.salesVatStatus,
    updatedAt: input.updatedAt.toISOString(),
  };
}

function parseSalesVatRate(
  input: SalesVatProfileUpdateInput,
): Prisma.Decimal | null | undefined {
  if (input.salesVatStatus !== "REGISTERED") {
    return input.salesVatRate === null ? null : undefined;
  }
  if (input.salesVatRate === null) return undefined;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.salesVatRate);
  if (match === null) return undefined;
  const integerDigits = (match[1] ?? "").replace(/^0+/, "") || "0";
  const fractionalDigits = match[2] ?? "";
  if (integerDigits.length > 2 || fractionalDigits.length > 6) return undefined;
  try {
    const rate = new Prisma.Decimal(input.salesVatRate);
    return rate.isPositive() && rate.lessThan(100) ? rate : undefined;
  } catch {
    return undefined;
  }
}

async function trustedContext(
  transaction: Transaction,
  input: { actorUserId: string; organizationId: string },
) {
  const [user, membership] = await Promise.all([
    transaction.user.findFirst({
      select: { id: true, status: true },
      where: { id: input.actorUserId, status: "ACTIVE" },
    }),
    transaction.organizationMembership.findUnique({
      select: {
        branchAssignments: {
          select: {
            branchId: true,
            organizationId: true,
            status: true,
            userId: true,
          },
        },
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
    }),
  ]);
  if (user === null || membership === null) return null;
  return createTrustedAuthorizationContext({
    actor: user,
    branchAssignments: membership.branchAssignments,
    membership,
  });
}

async function authorizedOrganization(
  transaction: Transaction,
  input: { actorUserId: string; organizationId: string },
) {
  const organization = await transaction.organization.findFirst({
    select: {
      id: true,
      salesVatRate: true,
      salesVatStatus: true,
      updatedAt: true,
    },
    where: { id: input.organizationId, status: "ACTIVE" },
  });
  if (organization === null) return null;
  const context = await trustedContext(transaction, input);
  const scope = createTrustedOrganizationScope(organization.id);
  return can(context, PERMISSIONS.ORGANIZATION_SETTINGS_MANAGE, scope)
    ? organization
    : null;
}

function nextUpdatedAt(expectedUpdatedAt: Date, currentTime: Date): Date {
  return new Date(
    Math.max(expectedUpdatedAt.getTime() + 1, currentTime.getTime()),
  );
}

export function createPrismaSalesApiRepository(
  prisma: PrismaClient,
  { now = () => new Date() }: { now?: () => Date } = {},
): SalesApiRepository {
  return {
    async getSalesVatProfile(input) {
      return prisma.$transaction(async (transaction) => {
        const organization = await authorizedOrganization(transaction, input);
        return organization === null
          ? { kind: "forbidden" as const }
          : { kind: "success" as const, profile: safeProfile(organization) };
      });
    },

    async searchPosProducts(input) {
      return prisma.$transaction(async (transaction) => {
        const [context, branch, organization] = await Promise.all([
          trustedContext(transaction, input),
          transaction.branch.findFirst({
            select: { id: true, organizationId: true, status: true },
            where: {
              id: input.branchId,
              organizationId: input.organizationId,
            },
          }),
          transaction.organization.findFirst({
            select: { id: true },
            where: { id: input.organizationId, status: "ACTIVE" },
          }),
        ]);
        if (branch === null || organization === null) {
          return { kind: "forbidden" as const };
        }
        const scope = createTrustedBranchScope({
          branchId: branch.id,
          branchOrganizationId: branch.organizationId,
          organizationId: input.organizationId,
        });
        if (!can(context, PERMISSIONS.CHECKOUT_PERFORM, scope)) {
          return { kind: "forbidden" as const };
        }
        if (branch.status !== "ACTIVE") {
          return { kind: "branch_inactive" as const };
        }

        const hash = filterHash({
          barcode: input.query.barcode ?? null,
          branchId: input.branchId,
          organizationId: input.organizationId,
          q: input.query.q,
        });
        const cursor =
          input.query.cursor === undefined
            ? null
            : decodeCursor(input.query.cursor, hash);
        if (input.query.cursor !== undefined && cursor === null) {
          return { kind: "invalid_cursor" as const };
        }
        const skuQuery = input.query.q.normalize("NFKC").toUpperCase();
        const filters: Prisma.ProductWhereInput[] = [
          { organizationId: input.organizationId },
          { status: "ACTIVE" },
        ];
        if (input.query.barcode !== undefined) {
          filters.push({ barcode: input.query.barcode });
        }
        if (input.query.q !== "") {
          filters.push({
            OR: [
              {
                name: {
                  contains: input.query.q,
                  mode: "insensitive" as const,
                },
              },
              { sku: { contains: skuQuery } },
              { barcode: { contains: input.query.q } },
            ],
          });
        }
        if (cursor !== null) {
          filters.push({
            OR: [
              { name: { gt: cursor.name } },
              { name: cursor.name, id: { gt: cursor.id } },
            ],
          });
        }
        const rows = await transaction.product.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: {
            barcode: true,
            basePrice: true,
            id: true,
            inventoryBalances: {
              select: { quantity: true },
              where: { branchId: input.branchId },
            },
            name: true,
            sku: true,
            unit: true,
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
                  name: last.name,
                  version: 1,
                })
              : null,
          products: page.map((product) => ({
            available:
              product.inventoryBalances[0]?.quantity.greaterThan(0) ?? false,
            barcode: product.barcode,
            basePrice: product.basePrice.toFixed(4),
            id: product.id,
            name: product.name,
            sku: product.sku,
            unit: product.unit,
          })),
        };
      });
    },

    async updateSalesVatProfile(input) {
      const salesVatRate = parseSalesVatRate(input.profile);
      if (salesVatRate === undefined) return { kind: "invalid_profile" };
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "organizations"
          WHERE "id" = ${input.organizationId}::uuid
          FOR UPDATE
        `);
        const organization = await authorizedOrganization(transaction, input);
        if (organization === null) return { kind: "forbidden" as const };
        if (
          organization.updatedAt.getTime() !==
          input.profile.expectedUpdatedAt.getTime()
        ) {
          return { kind: "stale" as const };
        }
        const updated = await transaction.organization.update({
          data: {
            salesVatRate,
            salesVatStatus: input.profile.salesVatStatus,
            updatedAt: nextUpdatedAt(input.profile.expectedUpdatedAt, now()),
          },
          select: {
            salesVatRate: true,
            salesVatStatus: true,
            updatedAt: true,
          },
          where: { id: organization.id },
        });
        return { kind: "success" as const, profile: safeProfile(updated) };
      });
    },
  };
}
