import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import {
  can,
  createTrustedAuthorizationContext,
  createTrustedBranchScope,
  createTrustedOrganizationScope,
  PERMISSIONS,
  type Permission,
  type ResolvedAuthorizationState,
  type TrustedAuthorizationContext,
  type TrustedResourceScope,
} from "../identity/authorization-policy.ts";
import type {
  CategoryCreateInput,
  CategoryListInput,
  CategoryUpdateInput,
  ProductCreateInput,
  ProductListInput,
  ProductUpdateInput,
} from "./catalog-schemas.ts";

export interface SafeCategory {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  status: "ACTIVE" | "INACTIVE";
  updatedAt: string;
}

export interface SafeProduct {
  barcode: string | null;
  basePrice: string;
  categoryId: string | null;
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  sku: string;
  status: "ACTIVE" | "INACTIVE";
  unit: "EA" | "PACK" | "BOX" | "KG" | "G" | "L" | "ML" | "M" | "CM";
  updatedAt: string;
}

type AuthorizationFailure =
  { kind: "branch_context_required" } | { kind: "forbidden" };

export type CategoryOutcome =
  | { category: SafeCategory; kind: "success" }
  | AuthorizationFailure
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "name_conflict" };

export type ProductOutcome =
  | { kind: "success"; product: SafeProduct }
  | AuthorizationFailure
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "sku_conflict" }
  | { kind: "barcode_conflict" }
  | { kind: "category_not_found" }
  | { kind: "category_inactive" };

export type CategoryListOutcome =
  | { categories: SafeCategory[]; kind: "success"; nextCursor: string | null }
  | AuthorizationFailure
  | { kind: "invalid_cursor" };

export type ProductListOutcome =
  | { kind: "success"; nextCursor: string | null; products: SafeProduct[] }
  | AuthorizationFailure
  | { kind: "invalid_cursor" };

export interface CatalogRepository {
  createCategory(input: {
    actorUserId: string;
    branchId?: string;
    category: CategoryCreateInput;
    organizationId: string;
  }): Promise<CategoryOutcome>;
  createProduct(input: {
    actorUserId: string;
    branchId?: string;
    organizationId: string;
    product: ProductCreateInput;
  }): Promise<ProductOutcome>;
  getCategory(input: {
    actorUserId: string;
    branchId?: string;
    categoryId: string;
    organizationId: string;
  }): Promise<CategoryOutcome>;
  getProduct(input: {
    actorUserId: string;
    branchId?: string;
    organizationId: string;
    productId: string;
  }): Promise<ProductOutcome>;
  listCategories(input: {
    actorUserId: string;
    organizationId: string;
    query: CategoryListInput;
  }): Promise<CategoryListOutcome>;
  listProducts(input: {
    actorUserId: string;
    organizationId: string;
    query: ProductListInput;
  }): Promise<ProductListOutcome>;
  setCategoryLifecycle(input: {
    actorUserId: string;
    branchId?: string;
    categoryId: string;
    expectedUpdatedAt: Date;
    organizationId: string;
    status: "ACTIVE" | "INACTIVE";
  }): Promise<CategoryOutcome>;
  setProductLifecycle(input: {
    actorUserId: string;
    branchId?: string;
    expectedUpdatedAt: Date;
    organizationId: string;
    productId: string;
    status: "ACTIVE" | "INACTIVE";
  }): Promise<ProductOutcome>;
  updateCategory(input: {
    actorUserId: string;
    branchId?: string;
    categoryId: string;
    category: CategoryUpdateInput;
    organizationId: string;
  }): Promise<CategoryOutcome>;
  updateProduct(input: {
    actorUserId: string;
    branchId?: string;
    organizationId: string;
    product: ProductUpdateInput;
    productId: string;
  }): Promise<ProductOutcome>;
}

type Transaction = Prisma.TransactionClient;

const categorySelection = {
  createdAt: true,
  description: true,
  id: true,
  name: true,
  organizationId: true,
  status: true,
  updatedAt: true,
} as const;

const productSelection = {
  barcode: true,
  basePrice: true,
  categoryId: true,
  createdAt: true,
  description: true,
  id: true,
  name: true,
  organizationId: true,
  sku: true,
  status: true,
  unit: true,
  updatedAt: true,
} as const;

function safeCategory(category: {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  status: "ACTIVE" | "INACTIVE";
  updatedAt: Date;
}): SafeCategory {
  return {
    ...category,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

function safeProduct(product: {
  barcode: string | null;
  basePrice: Prisma.Decimal;
  categoryId: string | null;
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  sku: string;
  status: "ACTIVE" | "INACTIVE";
  unit: SafeProduct["unit"];
  updatedAt: Date;
}): SafeProduct {
  return {
    ...product,
    basePrice: product.basePrice.toFixed(4),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function nextUpdatedAt(expectedUpdatedAt: Date, currentTime: Date): Date {
  return new Date(
    Math.max(expectedUpdatedAt.getTime() + 1, currentTime.getTime()),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function constraintFields(
  error: Prisma.PrismaClientKnownRequestError,
): unknown {
  const direct = error.meta?.target;
  if (direct !== undefined) return direct;
  const adapter = error.meta?.driverAdapterError;
  if (!isRecord(adapter) || !isRecord(adapter.cause)) return undefined;
  const constraint = adapter.cause.constraint;
  return isRecord(constraint) ? constraint.fields : undefined;
}

function constraintMatches(
  error: unknown,
  accepted: readonly string[],
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const fields = constraintFields(error);
  if (typeof fields === "string") return accepted.includes(fields);
  return (
    Array.isArray(fields) && accepted.some((field) => fields.includes(field))
  );
}

function categoryConflict(error: unknown): boolean {
  return constraintMatches(error, [
    "categories_organization_id_normalized_name_key",
    "normalizedName",
    "normalized_name",
  ]);
}

function skuConflict(error: unknown): boolean {
  return constraintMatches(error, ["products_organization_id_sku_key", "sku"]);
}

function barcodeConflict(error: unknown): boolean {
  return constraintMatches(error, [
    "products_organization_id_barcode_key",
    "barcode",
  ]);
}

async function authorize(
  transaction: Transaction,
  input: {
    actorUserId: string;
    branchId?: string;
    organizationId: string;
    permission: Permission;
  },
): Promise<
  | {
      context: TrustedAuthorizationContext;
      kind: "allowed";
      scope: TrustedResourceScope;
    }
  | AuthorizationFailure
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
  const context = createTrustedAuthorizationContext(state);
  if (context === null) return { kind: "forbidden" };
  if (
    context.actorStatus !== "ACTIVE" ||
    context.membershipStatus !== "ACTIVE"
  ) {
    return { kind: "forbidden" };
  }

  if (input.branchId === undefined) {
    if (context.role !== "OWNER" && context.role !== "ADMIN") {
      return { kind: "branch_context_required" };
    }
    const scope = createTrustedOrganizationScope(input.organizationId);
    if (scope === null || !can(context, input.permission, scope)) {
      return { kind: "forbidden" };
    }
    return { context, kind: "allowed", scope };
  }

  const branch = await transaction.branch.findFirst({
    where: {
      id: input.branchId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
    select: { id: true, organizationId: true },
  });
  if (branch === null) return { kind: "forbidden" };
  const scope = createTrustedBranchScope({
    branchId: branch.id,
    branchOrganizationId: branch.organizationId,
    organizationId: input.organizationId,
  });
  if (scope === null || !can(context, input.permission, scope)) {
    return { kind: "forbidden" };
  }
  return { context, kind: "allowed", scope };
}

function canIncludeInactive(
  context: TrustedAuthorizationContext,
  scope: TrustedResourceScope,
): boolean {
  return (
    can(context, PERMISSIONS.CATALOG_CREATE_EDIT, scope) ||
    can(context, PERMISSIONS.CATALOG_DEACTIVATE, scope)
  );
}

interface CursorValue {
  createdAt: string;
  filterHash: string;
  id: string;
  version: 1;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MILLISECOND_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
    if (!isRecord(value)) return null;
    if (
      value.version !== 1 ||
      typeof value.createdAt !== "string" ||
      !MILLISECOND_UTC_PATTERN.test(value.createdAt) ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      typeof value.id !== "string" ||
      !UUID_PATTERN.test(value.id) ||
      value.filterHash !== expectedFilterHash
    ) {
      return null;
    }
    return value as unknown as CursorValue;
  } catch {
    return null;
  }
}

function cursorWhere(cursor: CursorValue | null): {
  OR?: Array<
    { createdAt: { gt: Date } } | { createdAt: Date; id: { gt: string } }
  >;
} {
  if (cursor === null) return {};
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { gt: createdAt } },
      { createdAt, id: { gt: cursor.id } },
    ],
  };
}

async function lockedCategory(
  transaction: Transaction,
  organizationId: string,
  categoryId: string,
): Promise<"ACTIVE" | "INACTIVE" | null> {
  const rows = await transaction.$queryRaw<
    Array<{ status: "ACTIVE" | "INACTIVE" }>
  >(Prisma.sql`
    SELECT "status"
    FROM "categories"
    WHERE "id" = ${categoryId}::uuid
      AND "organization_id" = ${organizationId}::uuid
    FOR SHARE
  `);
  return rows[0]?.status ?? null;
}

export function createPrismaCatalogRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): CatalogRepository {
  return {
    async createCategory(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const access = await authorize(transaction, {
            actorUserId: input.actorUserId,
            ...(input.branchId === undefined
              ? {}
              : { branchId: input.branchId }),
            organizationId: input.organizationId,
            permission: PERMISSIONS.CATALOG_CREATE_EDIT,
          });
          if (access.kind !== "allowed") return access;
          const category = await transaction.category.create({
            data: {
              description: input.category.description,
              name: input.category.name.name,
              normalizedName: input.category.name.normalizedName,
              organizationId: input.organizationId,
            },
            select: categorySelection,
          });
          return { category: safeCategory(category), kind: "success" as const };
        });
      } catch (error: unknown) {
        if (categoryConflict(error)) return { kind: "name_conflict" };
        throw error;
      }
    },

    async getCategory(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          organizationId: input.organizationId,
          permission: PERMISSIONS.CATALOG_VIEW,
        });
        if (access.kind !== "allowed") return access;
        const category = await transaction.category.findFirst({
          where: { id: input.categoryId, organizationId: input.organizationId },
          select: categorySelection,
        });
        return category === null
          ? { kind: "not_found" as const }
          : { category: safeCategory(category), kind: "success" as const };
      });
    },

    async listCategories(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          ...(input.query.branchId === undefined
            ? {}
            : { branchId: input.query.branchId }),
          organizationId: input.organizationId,
          permission: PERMISSIONS.CATALOG_VIEW,
        });
        if (access.kind !== "allowed") return access;
        if (
          input.query.includeInactive &&
          !canIncludeInactive(access.context, access.scope)
        ) {
          return { kind: "forbidden" as const };
        }
        const hash = filterHash({
          branchId: input.query.branchId ?? null,
          includeInactive: input.query.includeInactive,
          organizationId: input.organizationId,
          q: input.query.q,
          resource: "category",
        });
        const cursor =
          input.query.cursor === undefined
            ? null
            : decodeCursor(input.query.cursor, hash);
        if (input.query.cursor !== undefined && cursor === null) {
          return { kind: "invalid_cursor" as const };
        }
        const rows = await transaction.category.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: input.query.limit + 1,
          where: {
            ...cursorWhere(cursor),
            organizationId: input.organizationId,
            ...(input.query.includeInactive
              ? {}
              : { status: "ACTIVE" as const }),
            ...(input.query.q === ""
              ? {}
              : { normalizedName: { contains: input.query.q } }),
          },
          select: categorySelection,
        });
        const hasMore = rows.length > input.query.limit;
        const page = hasMore ? rows.slice(0, input.query.limit) : rows;
        const last = page.at(-1);
        return {
          categories: page.map(safeCategory),
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

    async updateCategory(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const access = await authorize(transaction, {
            actorUserId: input.actorUserId,
            ...(input.branchId === undefined
              ? {}
              : { branchId: input.branchId }),
            organizationId: input.organizationId,
            permission: PERMISSIONS.CATALOG_CREATE_EDIT,
          });
          if (access.kind !== "allowed") return access;
          const current = await transaction.category.findFirst({
            where: {
              id: input.categoryId,
              organizationId: input.organizationId,
            },
            select: categorySelection,
          });
          if (current === null) return { kind: "not_found" as const };
          const updated = await transaction.category.updateMany({
            data: {
              ...(input.category.description === undefined
                ? {}
                : { description: input.category.description }),
              ...(input.category.name === undefined
                ? {}
                : {
                    name: input.category.name.name,
                    normalizedName: input.category.name.normalizedName,
                  }),
              updatedAt: nextUpdatedAt(input.category.expectedUpdatedAt, now()),
            },
            where: {
              id: input.categoryId,
              organizationId: input.organizationId,
              updatedAt: input.category.expectedUpdatedAt,
            },
          });
          if (updated.count === 0) return { kind: "stale" as const };
          const category = await transaction.category.findFirstOrThrow({
            where: {
              id: input.categoryId,
              organizationId: input.organizationId,
            },
            select: categorySelection,
          });
          return { category: safeCategory(category), kind: "success" as const };
        });
      } catch (error: unknown) {
        if (categoryConflict(error)) return { kind: "name_conflict" };
        throw error;
      }
    },

    async setCategoryLifecycle(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          organizationId: input.organizationId,
          permission: PERMISSIONS.CATALOG_DEACTIVATE,
        });
        if (access.kind !== "allowed") return access;
        const current = await transaction.category.findFirst({
          where: { id: input.categoryId, organizationId: input.organizationId },
          select: categorySelection,
        });
        if (current === null) return { kind: "not_found" as const };
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          return { kind: "stale" as const };
        }
        if (current.status === input.status) {
          return { category: safeCategory(current), kind: "success" as const };
        }
        const updated = await transaction.category.updateMany({
          data: {
            status: input.status,
            updatedAt: nextUpdatedAt(input.expectedUpdatedAt, now()),
          },
          where: {
            id: input.categoryId,
            organizationId: input.organizationId,
            updatedAt: input.expectedUpdatedAt,
          },
        });
        if (updated.count === 0) return { kind: "stale" as const };
        const category = await transaction.category.findFirstOrThrow({
          where: { id: input.categoryId, organizationId: input.organizationId },
          select: categorySelection,
        });
        return { category: safeCategory(category), kind: "success" as const };
      });
    },

    async createProduct(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const access = await authorize(transaction, {
            actorUserId: input.actorUserId,
            ...(input.branchId === undefined
              ? {}
              : { branchId: input.branchId }),
            organizationId: input.organizationId,
            permission: PERMISSIONS.CATALOG_CREATE_EDIT,
          });
          if (access.kind !== "allowed") return access;
          if (input.product.categoryId !== null) {
            const status = await lockedCategory(
              transaction,
              input.organizationId,
              input.product.categoryId,
            );
            if (status === null) return { kind: "category_not_found" as const };
            if (status === "INACTIVE")
              return { kind: "category_inactive" as const };
          }
          const product = await transaction.product.create({
            data: {
              barcode: input.product.barcode,
              basePrice: input.product.basePrice,
              categoryId: input.product.categoryId,
              description: input.product.description,
              name: input.product.name,
              organizationId: input.organizationId,
              sku: input.product.sku,
              unit: input.product.unit,
            },
            select: productSelection,
          });
          return { kind: "success" as const, product: safeProduct(product) };
        });
      } catch (error: unknown) {
        if (skuConflict(error)) return { kind: "sku_conflict" };
        if (barcodeConflict(error)) return { kind: "barcode_conflict" };
        throw error;
      }
    },

    async getProduct(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          organizationId: input.organizationId,
          permission: PERMISSIONS.CATALOG_VIEW,
        });
        if (access.kind !== "allowed") return access;
        const product = await transaction.product.findFirst({
          where: { id: input.productId, organizationId: input.organizationId },
          select: productSelection,
        });
        return product === null
          ? { kind: "not_found" as const }
          : { kind: "success" as const, product: safeProduct(product) };
      });
    },

    async listProducts(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          ...(input.query.branchId === undefined
            ? {}
            : { branchId: input.query.branchId }),
          organizationId: input.organizationId,
          permission: PERMISSIONS.CATALOG_VIEW,
        });
        if (access.kind !== "allowed") return access;
        if (
          input.query.includeInactive &&
          !canIncludeInactive(access.context, access.scope)
        ) {
          return { kind: "forbidden" as const };
        }
        const hash = filterHash({
          branchId: input.query.branchId ?? null,
          categoryId: input.query.categoryId ?? null,
          includeInactive: input.query.includeInactive,
          organizationId: input.organizationId,
          q: input.query.q,
          resource: "product",
        });
        const cursor =
          input.query.cursor === undefined
            ? null
            : decodeCursor(input.query.cursor, hash);
        if (input.query.cursor !== undefined && cursor === null) {
          return { kind: "invalid_cursor" as const };
        }
        const trimmedQuery = input.query.q;
        const skuQuery = trimmedQuery.normalize("NFKC").toUpperCase();
        const filters: Prisma.ProductWhereInput[] = [
          { organizationId: input.organizationId },
          cursorWhere(cursor),
        ];
        if (!input.query.includeInactive) filters.push({ status: "ACTIVE" });
        if (input.query.categoryId === "uncategorized") {
          filters.push({ categoryId: null });
        } else if (input.query.categoryId !== undefined) {
          filters.push({ categoryId: input.query.categoryId });
        }
        if (trimmedQuery !== "") {
          filters.push({
            OR: [
              { name: { contains: trimmedQuery, mode: "insensitive" } },
              { sku: { startsWith: skuQuery } },
              { barcode: trimmedQuery },
            ],
          });
        }
        const rows = await transaction.product.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: input.query.limit + 1,
          where: { AND: filters },
          select: productSelection,
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
          products: page.map(safeProduct),
        };
      });
    },

    async updateProduct(input) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const access = await authorize(transaction, {
            actorUserId: input.actorUserId,
            ...(input.branchId === undefined
              ? {}
              : { branchId: input.branchId }),
            organizationId: input.organizationId,
            permission: PERMISSIONS.CATALOG_CREATE_EDIT,
          });
          if (access.kind !== "allowed") return access;
          const current = await transaction.product.findFirst({
            where: {
              id: input.productId,
              organizationId: input.organizationId,
            },
            select: productSelection,
          });
          if (current === null) return { kind: "not_found" as const };
          if (
            input.product.categoryId !== undefined &&
            input.product.categoryId !== null &&
            input.product.categoryId !== current.categoryId
          ) {
            const status = await lockedCategory(
              transaction,
              input.organizationId,
              input.product.categoryId,
            );
            if (status === null) return { kind: "category_not_found" as const };
            if (status === "INACTIVE")
              return { kind: "category_inactive" as const };
          }
          const updated = await transaction.product.updateMany({
            data: {
              ...(input.product.barcode === undefined
                ? {}
                : { barcode: input.product.barcode }),
              ...(input.product.basePrice === undefined
                ? {}
                : { basePrice: input.product.basePrice }),
              ...(input.product.categoryId === undefined
                ? {}
                : { categoryId: input.product.categoryId }),
              ...(input.product.description === undefined
                ? {}
                : { description: input.product.description }),
              ...(input.product.name === undefined
                ? {}
                : { name: input.product.name }),
              ...(input.product.sku === undefined
                ? {}
                : { sku: input.product.sku }),
              updatedAt: nextUpdatedAt(input.product.expectedUpdatedAt, now()),
            },
            where: {
              id: input.productId,
              organizationId: input.organizationId,
              updatedAt: input.product.expectedUpdatedAt,
            },
          });
          if (updated.count === 0) return { kind: "stale" as const };
          const product = await transaction.product.findFirstOrThrow({
            where: {
              id: input.productId,
              organizationId: input.organizationId,
            },
            select: productSelection,
          });
          return { kind: "success" as const, product: safeProduct(product) };
        });
      } catch (error: unknown) {
        if (skuConflict(error)) return { kind: "sku_conflict" };
        if (barcodeConflict(error)) return { kind: "barcode_conflict" };
        throw error;
      }
    },

    async setProductLifecycle(input) {
      return prisma.$transaction(async (transaction) => {
        const access = await authorize(transaction, {
          actorUserId: input.actorUserId,
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          organizationId: input.organizationId,
          permission: PERMISSIONS.CATALOG_DEACTIVATE,
        });
        if (access.kind !== "allowed") return access;
        const current = await transaction.product.findFirst({
          where: { id: input.productId, organizationId: input.organizationId },
          select: productSelection,
        });
        if (current === null) return { kind: "not_found" as const };
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          return { kind: "stale" as const };
        }
        if (current.status === input.status) {
          return { kind: "success" as const, product: safeProduct(current) };
        }
        const updated = await transaction.product.updateMany({
          data: {
            status: input.status,
            updatedAt: nextUpdatedAt(input.expectedUpdatedAt, now()),
          },
          where: {
            id: input.productId,
            organizationId: input.organizationId,
            updatedAt: input.expectedUpdatedAt,
          },
        });
        if (updated.count === 0) return { kind: "stale" as const };
        const product = await transaction.product.findFirstOrThrow({
          where: { id: input.productId, organizationId: input.organizationId },
          select: productSelection,
        });
        return { kind: "success" as const, product: safeProduct(product) };
      });
    },
  };
}
