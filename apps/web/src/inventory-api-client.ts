import { z } from "zod";
import { privateFetch, readPrivateJson } from "@/session-lifecycle";

const productUnitSchema = z.enum([
  "EA",
  "PACK",
  "BOX",
  "KG",
  "G",
  "L",
  "ML",
  "M",
  "CM",
]);
const productStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
const timestampSchema = z.string().datetime({ offset: false, precision: 3 });
const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });

const inventoryProductSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  id: z.string().uuid(),
  name: z.string(),
  sku: z.string(),
  status: productStatusSchema,
  unit: productUnitSchema,
});
const inventoryBalanceSchema = z.object({
  exists: z.boolean(),
  quantity: z.string(),
  updatedAt: timestampSchema.nullable(),
});
const inventoryItemSchema = z.object({
  balance: inventoryBalanceSchema,
  product: inventoryProductSchema,
});
const inventoryTransactionSchema = z.object({
  actor: z.object({
    displayName: z.string().nullable(),
    id: z.string().uuid(),
  }),
  delta: z.string(),
  id: z.string().uuid(),
  note: z.string().nullable(),
  occurredAt: timestampSchema,
  reason: z.string().nullable(),
  source: z.string(),
});
const inventoryListResponseSchema = z.object({
  data: z.array(inventoryItemSchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
const inventoryDetailResponseSchema = z.object({ data: inventoryItemSchema });
const inventoryHistoryResponseSchema = z.object({
  data: z.array(inventoryTransactionSchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
const inventoryAdjustmentResponseSchema = z.object({
  data: z.object({
    balance: z.object({ quantity: z.string() }),
    transaction: inventoryTransactionSchema.omit({ actor: true }),
  }),
});

export type InventoryProduct = z.infer<typeof inventoryProductSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventoryTransaction = z.infer<typeof inventoryTransactionSchema>;
export type InventoryUnit = z.infer<typeof productUnitSchema>;
export type InventoryAdjustmentReason =
  "STOCK_COUNT" | "DAMAGE" | "LOSS" | "FOUND" | "CORRECTION" | "OTHER";

export interface InventoryRequestContext {
  branchId: string;
  organizationId: string;
}

export interface InventoryListOptions {
  categoryId?: "uncategorized" | string;
  cursor?: string | null;
  limit?: number;
  status?: "ACTIVE" | "INACTIVE" | "ALL";
}

export type InventoryApiErrorKind =
  | "authentication_required"
  | "branch_inactive"
  | "forbidden"
  | "idempotency_conflict"
  | "insufficient_stock"
  | "invalid_cursor"
  | "product_inactive"
  | "product_not_found"
  | "unavailable"
  | "validation";

export class InventoryApiError extends Error {
  constructor(readonly kind: InventoryApiErrorKind) {
    super(kind);
  }
}

function queryString(
  values: Record<string, number | string | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function inventoryPath(
  context: InventoryRequestContext,
  productId?: string,
): string {
  const base = `organizations/${context.organizationId}/branches/${context.branchId}/inventory`;
  return productId === undefined ? base : `${base}/${productId}`;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await privateFetch(`/api/v1/${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init?.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new InventoryApiError("unavailable");
  }

  let body: unknown;
  try {
    body = await readPrivateJson(response);
  } catch {
    throw new InventoryApiError("unavailable");
  }
  if (!response.ok) throw errorFromResponse(response.status, body);
  return body;
}

function errorFromResponse(status: number, body: unknown): InventoryApiError {
  const parsed = apiErrorSchema.safeParse(body);
  const kinds: Record<string, InventoryApiErrorKind> = {
    BRANCH_INACTIVE: "branch_inactive",
    FORBIDDEN: "forbidden",
    IDEMPOTENCY_CONFLICT: "idempotency_conflict",
    INSUFFICIENT_STOCK: "insufficient_stock",
    INVALID_CURSOR: "invalid_cursor",
    PRODUCT_INACTIVE: "product_inactive",
    PRODUCT_NOT_FOUND: "product_not_found",
    VALIDATION_ERROR: "validation",
  };
  if (status === 401) return new InventoryApiError("authentication_required");
  if (status === 403) return new InventoryApiError("forbidden");
  return new InventoryApiError(
    parsed.success
      ? (kinds[parsed.data.error.code] ?? "unavailable")
      : "unavailable",
  );
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InventoryApiError("unavailable");
  return parsed.data;
}

export async function listInventory(
  context: InventoryRequestContext,
  options: InventoryListOptions = {},
) {
  return parse(
    inventoryListResponseSchema,
    await request(
      `${inventoryPath(context)}${queryString({
        categoryId: options.categoryId,
        cursor: options.cursor,
        limit: options.limit,
        status: options.status,
      })}`,
    ),
  );
}

export async function getInventoryItem(
  context: InventoryRequestContext,
  productId: string,
) {
  return parse(
    inventoryDetailResponseSchema,
    await request(inventoryPath(context, productId)),
  ).data;
}

export async function listInventoryHistory(
  context: InventoryRequestContext,
  productId: string,
  options: { cursor?: string | null; limit?: number } = {},
) {
  return parse(
    inventoryHistoryResponseSchema,
    await request(
      `${inventoryPath(context, productId)}/transactions${queryString(options)}`,
    ),
  );
}

export async function createInventoryAdjustment(
  context: InventoryRequestContext,
  idempotencyKey: string,
  input: {
    delta: string;
    note: string;
    productId: string;
    reason: InventoryAdjustmentReason;
  },
) {
  return parse(
    inventoryAdjustmentResponseSchema,
    await request(`${inventoryPath(context)}/adjustments`, {
      body: JSON.stringify(input),
      headers: { "Idempotency-Key": idempotencyKey },
      method: "POST",
    }),
  ).data;
}
