import { z } from "zod";

import {
  canonicalizeBarcode,
  canonicalizeCategoryName,
  canonicalizeProductName,
  canonicalizeSku,
  parseCatalogBasePrice,
} from "./catalog-values.ts";

const PRODUCT_UNITS = [
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

function parsedString<T>(parser: (value: string) => T) {
  return z.string().transform((value, context): T => {
    try {
      return parser(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid catalog value." });
      return z.NEVER;
    }
  });
}

const categoryNameSchema = parsedString(canonicalizeCategoryName);
const productNameSchema = parsedString(canonicalizeProductName);
const skuSchema = parsedString(canonicalizeSku);
const basePriceSchema = parsedString(parseCatalogBasePrice);
const barcodeSchema = z
  .union([z.string(), z.null()])
  .transform((value, context): string | null => {
    try {
      return canonicalizeBarcode(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid barcode." });
      return z.NEVER;
    }
  });
const descriptionSchema = z.union([z.string(), z.null()]).transform((value) => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
});
const expectedUpdatedAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value));
const includeInactiveSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");
const limitSchema = z.preprocess(
  (value) => value ?? "25",
  z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
);
const optionalQuerySchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? "");

export const organizationCatalogParamsSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();

export const categoryParamsSchema = z
  .object({
    categoryId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

export const productParamsSchema = z
  .object({
    organizationId: z.string().uuid(),
    productId: z.string().uuid(),
  })
  .strict();

export const branchContextQuerySchema = z
  .object({ branchId: z.string().uuid().optional() })
  .strict();

export const categoryCreateRequestSchema = z
  .object({
    description: descriptionSchema
      .optional()
      .transform((value) => value ?? null),
    name: categoryNameSchema,
  })
  .strict();

export const categoryUpdateRequestSchema = z
  .object({
    description: descriptionSchema.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: categoryNameSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.description !== undefined,
  );

export const catalogLifecycleRequestSchema = z
  .object({ expectedUpdatedAt: expectedUpdatedAtSchema })
  .strict();

export const categoryListQuerySchema = z
  .object({
    branchId: z.string().uuid().optional(),
    cursor: z.string().min(1).optional(),
    includeInactive: includeInactiveSchema,
    limit: limitSchema,
    q: optionalQuerySchema.transform((value, context) => {
      if (value === "") return "";
      try {
        return canonicalizeCategoryName(value).normalizedName;
      } catch {
        context.addIssue({ code: "custom", message: "Invalid search value." });
        return z.NEVER;
      }
    }),
  })
  .strict();

export const productCreateRequestSchema = z
  .object({
    barcode: barcodeSchema.optional().transform((value) => value ?? null),
    basePrice: basePriceSchema,
    categoryId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    description: descriptionSchema
      .optional()
      .transform((value) => value ?? null),
    name: productNameSchema,
    sku: skuSchema,
    unit: z.enum(PRODUCT_UNITS),
  })
  .strict();

export const productUpdateRequestSchema = z
  .object({
    barcode: barcodeSchema.optional(),
    basePrice: basePriceSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    description: descriptionSchema.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: productNameSchema.optional(),
    sku: skuSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.sku !== undefined ||
      input.barcode !== undefined ||
      input.basePrice !== undefined ||
      input.categoryId !== undefined,
  );

export const productListQuerySchema = z
  .object({
    branchId: z.string().uuid().optional(),
    categoryId: z
      .union([z.string().uuid(), z.literal("uncategorized")])
      .optional(),
    cursor: z.string().min(1).optional(),
    includeInactive: includeInactiveSchema,
    limit: limitSchema,
    q: optionalQuerySchema,
  })
  .strict();

export type CategoryCreateInput = z.infer<typeof categoryCreateRequestSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateRequestSchema>;
export type CategoryListInput = z.infer<typeof categoryListQuerySchema>;
export type ProductCreateInput = z.infer<typeof productCreateRequestSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateRequestSchema>;
export type ProductListInput = z.infer<typeof productListQuerySchema>;
