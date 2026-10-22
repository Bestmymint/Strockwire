import { z } from "zod";
import { privateFetch, readPrivateJson } from "@/session-lifecycle";

const catalogStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export const PRODUCT_UNITS = [
  "EA",
  "PACK",
  "BOX",
  "KG",
  "G",
  "L",
  "ML",
  "M",
  "CM",
] as const;
const productUnitSchema = z.enum(PRODUCT_UNITS);
const timestampSchema = z.string().datetime({ offset: false, precision: 3 });

const categorySchema = z.object({
  createdAt: timestampSchema,
  description: z.string().nullable(),
  id: z.string().uuid(),
  name: z.string(),
  organizationId: z.string().uuid(),
  status: catalogStatusSchema,
  updatedAt: timestampSchema,
});

const productSchema = z.object({
  barcode: z.string().nullable(),
  basePrice: z.string().regex(/^\d+\.\d{4}$/),
  categoryId: z.string().uuid().nullable(),
  createdAt: timestampSchema,
  description: z.string().nullable(),
  id: z.string().uuid(),
  name: z.string(),
  organizationId: z.string().uuid(),
  sku: z.string(),
  status: catalogStatusSchema,
  unit: productUnitSchema,
  updatedAt: timestampSchema,
});

const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });
const categoryResponseSchema = z.object({
  data: z.object({ category: categorySchema }),
});
const productResponseSchema = z.object({
  data: z.object({ product: productSchema }),
});
const categoryListResponseSchema = z.object({
  data: z.object({ categories: z.array(categorySchema) }),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
const productListResponseSchema = z.object({
  data: z.object({ products: z.array(productSchema) }),
  meta: z.object({ nextCursor: z.string().nullable() }),
});

export type CatalogStatus = z.infer<typeof catalogStatusSchema>;
export type ProductUnit = z.infer<typeof productUnitSchema>;
export type CatalogCategory = z.infer<typeof categorySchema>;
export type CatalogProduct = z.infer<typeof productSchema>;

export type CatalogApiErrorKind =
  | "authentication_required"
  | "barcode_conflict"
  | "branch_context_required"
  | "category_inactive"
  | "category_name_conflict"
  | "category_not_found"
  | "category_stale"
  | "forbidden"
  | "invalid_cursor"
  | "product_not_found"
  | "product_stale"
  | "sku_conflict"
  | "unavailable"
  | "validation";

export class CatalogApiError extends Error {
  constructor(readonly kind: CatalogApiErrorKind) {
    super(kind);
  }
}

export interface CatalogRequestContext {
  branchId?: string;
  organizationId: string;
}

export interface CatalogListOptions {
  cursor?: string | null;
  includeInactive?: boolean;
  limit?: number;
  q?: string;
}

export interface ProductListOptions extends CatalogListOptions {
  categoryId?: "uncategorized" | string;
}

function queryString(
  values: Record<string, boolean | number | string | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === false) continue;
    query.set(key, value === true ? "true" : String(value));
  }
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function contextQuery(context: CatalogRequestContext): string {
  return context.branchId === undefined
    ? ""
    : queryString({ branchId: context.branchId });
}

function catalogPath(
  context: CatalogRequestContext,
  resource: "categories" | "products",
  id?: string,
): string {
  const base = `organizations/${context.organizationId}/${resource}`;
  return id === undefined ? base : `${base}/${id}`;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await privateFetch(`/api/v1/${path}`, {
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init?.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...init,
    });
  } catch {
    throw new CatalogApiError("unavailable");
  }

  let body: unknown;
  try {
    body = await readPrivateJson(response);
  } catch {
    throw new CatalogApiError("unavailable");
  }

  if (!response.ok) throw errorFromResponse(response.status, body);
  return body;
}

function errorFromResponse(status: number, body: unknown): CatalogApiError {
  const parsed = apiErrorSchema.safeParse(body);
  const kinds: Record<string, CatalogApiErrorKind> = {
    AUTHENTICATION_REQUIRED: "authentication_required",
    BARCODE_CONFLICT: "barcode_conflict",
    BRANCH_CONTEXT_REQUIRED: "branch_context_required",
    CATEGORY_INACTIVE: "category_inactive",
    CATEGORY_NAME_CONFLICT: "category_name_conflict",
    CATEGORY_NOT_FOUND: "category_not_found",
    CATEGORY_STALE: "category_stale",
    FORBIDDEN: "forbidden",
    INVALID_CURSOR: "invalid_cursor",
    PRODUCT_NOT_FOUND: "product_not_found",
    PRODUCT_STALE: "product_stale",
    SKU_CONFLICT: "sku_conflict",
    VALIDATION_ERROR: "validation",
  };
  if (status === 401) return new CatalogApiError("authentication_required");
  if (status === 403) return new CatalogApiError("forbidden");
  return new CatalogApiError(
    parsed.success
      ? (kinds[parsed.data.error.code] ?? "unavailable")
      : "unavailable",
  );
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CatalogApiError("unavailable");
  return parsed.data;
}

export async function listCategories(
  context: CatalogRequestContext,
  options: CatalogListOptions = {},
) {
  return parse(
    categoryListResponseSchema,
    await request(
      `${catalogPath(context, "categories")}${queryString({
        branchId: context.branchId,
        cursor: options.cursor,
        includeInactive: options.includeInactive,
        limit: options.limit,
        q: options.q,
      })}`,
    ),
  );
}

export async function listProducts(
  context: CatalogRequestContext,
  options: ProductListOptions = {},
) {
  return parse(
    productListResponseSchema,
    await request(
      `${catalogPath(context, "products")}${queryString({
        branchId: context.branchId,
        categoryId: options.categoryId,
        cursor: options.cursor,
        includeInactive: options.includeInactive,
        limit: options.limit,
        q: options.q,
      })}`,
    ),
  );
}

export async function createCategory(
  context: CatalogRequestContext,
  input: { description: string; name: string },
): Promise<CatalogCategory> {
  return parse(
    categoryResponseSchema,
    await request(
      `${catalogPath(context, "categories")}${contextQuery(context)}`,
      {
        body: JSON.stringify(input),
        method: "POST",
      },
    ),
  ).data.category;
}

export async function updateCategory(
  context: CatalogRequestContext,
  categoryId: string,
  input: { description: string; expectedUpdatedAt: string; name: string },
): Promise<CatalogCategory> {
  return parse(
    categoryResponseSchema,
    await request(
      `${catalogPath(context, "categories", categoryId)}${contextQuery(context)}`,
      { body: JSON.stringify(input), method: "PATCH" },
    ),
  ).data.category;
}

export async function setCategoryLifecycle(
  context: CatalogRequestContext,
  category: Pick<CatalogCategory, "id" | "status" | "updatedAt">,
): Promise<CatalogCategory> {
  const command = category.status === "ACTIVE" ? "deactivate" : "reactivate";
  return parse(
    categoryResponseSchema,
    await request(
      `${catalogPath(context, "categories", category.id)}/${command}${contextQuery(context)}`,
      {
        body: JSON.stringify({ expectedUpdatedAt: category.updatedAt }),
        method: "POST",
      },
    ),
  ).data.category;
}

export async function createProduct(
  context: CatalogRequestContext,
  input: {
    barcode: string;
    basePrice: string;
    categoryId: string | null;
    description: string;
    name: string;
    sku: string;
    unit: ProductUnit;
  },
): Promise<CatalogProduct> {
  return parse(
    productResponseSchema,
    await request(
      `${catalogPath(context, "products")}${contextQuery(context)}`,
      {
        body: JSON.stringify(input),
        method: "POST",
      },
    ),
  ).data.product;
}

export async function updateProduct(
  context: CatalogRequestContext,
  productId: string,
  input: {
    barcode: string;
    basePrice: string;
    categoryId: string | null;
    description: string;
    expectedUpdatedAt: string;
    name: string;
    sku: string;
  },
): Promise<CatalogProduct> {
  return parse(
    productResponseSchema,
    await request(
      `${catalogPath(context, "products", productId)}${contextQuery(context)}`,
      { body: JSON.stringify(input), method: "PATCH" },
    ),
  ).data.product;
}

export async function setProductLifecycle(
  context: CatalogRequestContext,
  product: Pick<CatalogProduct, "id" | "status" | "updatedAt">,
): Promise<CatalogProduct> {
  const command = product.status === "ACTIVE" ? "deactivate" : "reactivate";
  return parse(
    productResponseSchema,
    await request(
      `${catalogPath(context, "products", product.id)}/${command}${contextQuery(context)}`,
      {
        body: JSON.stringify({ expectedUpdatedAt: product.updatedAt }),
        method: "POST",
      },
    ),
  ).data.product;
}
