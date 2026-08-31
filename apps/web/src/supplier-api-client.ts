import { z } from "zod";

const statusSchema = z.enum(["ACTIVE", "INACTIVE"]);
const timestampSchema = z.string().datetime({ offset: false, precision: 3 });
const supplierSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  status: statusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
const responseSchema = z.object({
  data: z.object({ supplier: supplierSchema }),
});
const listSchema = z.object({
  data: z.object({ suppliers: z.array(supplierSchema) }),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
export type Supplier = z.infer<typeof supplierSchema>;
export type SupplierStatusFilter = "active" | "inactive" | "all";
export class SupplierApiError extends Error {
  constructor(
    readonly kind:
      | "authentication_required"
      | "forbidden"
      | "invalid_cursor"
      | "not_found"
      | "unavailable"
      | "validation",
  ) {
    super(kind);
  }
}
function query(
  values: Record<string, string | number | null | undefined>,
): string {
  const result = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      result.set(key, String(value));
  });
  const encoded = result.toString();
  return encoded === "" ? "" : `?${encoded}`;
}
async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
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
    throw new SupplierApiError("unavailable");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SupplierApiError("unavailable");
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    if (response.status === 401)
      throw new SupplierApiError("authentication_required");
    if (response.status === 403) throw new SupplierApiError("forbidden");
    if (parsed.success && parsed.data.error.code === "INVALID_CURSOR")
      throw new SupplierApiError("invalid_cursor");
    if (parsed.success && parsed.data.error.code === "SUPPLIER_NOT_FOUND")
      throw new SupplierApiError("not_found");
    if (response.status === 400) throw new SupplierApiError("validation");
    throw new SupplierApiError("unavailable");
  }
  return body;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SupplierApiError("unavailable");
  return result.data;
}
function path(organizationId: string, supplierId?: string): string {
  return supplierId === undefined
    ? `organizations/${organizationId}/suppliers`
    : `organizations/${organizationId}/suppliers/${supplierId}`;
}
export function supplierScopeKey(organizationId: string) {
  return ["organization-scoped", organizationId, "suppliers"] as const;
}
export async function listSuppliers(
  organizationId: string,
  options: {
    cursor?: string | null;
    limit?: number;
    q?: string;
    status?: SupplierStatusFilter;
  } = {},
) {
  return parse(
    listSchema,
    await request(`${path(organizationId)}${query(options)}`),
  );
}
export async function createSupplier(
  organizationId: string,
  input: SupplierInput,
): Promise<Supplier> {
  return parse(
    responseSchema,
    await request(path(organizationId), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ).data.supplier;
}
export async function updateSupplier(
  organizationId: string,
  supplierId: string,
  input: Partial<SupplierInput>,
): Promise<Supplier> {
  return parse(
    responseSchema,
    await request(path(organizationId, supplierId), {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  ).data.supplier;
}
export async function setSupplierLifecycle(
  organizationId: string,
  supplier: Pick<Supplier, "id" | "status">,
): Promise<Supplier> {
  const command = supplier.status === "ACTIVE" ? "deactivate" : "reactivate";
  return parse(
    responseSchema,
    await request(`${path(organizationId, supplier.id)}/${command}`, {
      method: "POST",
      body: "{}",
    }),
  ).data.supplier;
}
export interface SupplierInput {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
}
