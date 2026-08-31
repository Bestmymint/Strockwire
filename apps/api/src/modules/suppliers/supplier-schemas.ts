import { z } from "zod";

import {
  supplierAddress,
  supplierContactName,
  supplierEmail,
  supplierName,
  supplierPhone,
} from "./supplier-values.ts";

function parsed<T>(parser: (value: string | null | undefined) => T) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value, context): T => {
      try {
        return parser(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid supplier value.",
        });
        return z.NEVER;
      }
    });
}

const requiredName = z.string().transform((value, context) => {
  try {
    return supplierName(value);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid supplier name." });
    return z.NEVER;
  }
});
const limitSchema = z.preprocess(
  (value) => value ?? "25",
  z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
);
const searchSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? "");

export const supplierOrganizationParamsSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
export const supplierParamsSchema = z
  .object({ organizationId: z.string().uuid(), supplierId: z.string().uuid() })
  .strict();
export const supplierCreateRequestSchema = z
  .object({
    name: requiredName,
    contactName: parsed(supplierContactName),
    email: parsed(supplierEmail),
    phone: parsed(supplierPhone),
    address: parsed(supplierAddress),
  })
  .strict();
export const supplierUpdateRequestSchema = z
  .object({
    name: requiredName.optional(),
    contactName: parsed(supplierContactName).optional(),
    email: parsed(supplierEmail).optional(),
    phone: parsed(supplierPhone).optional(),
    address: parsed(supplierAddress).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export const supplierListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: limitSchema,
    q: searchSchema,
    status: z.enum(["active", "inactive", "all"]).optional().default("active"),
  })
  .strict();
export type SupplierCreateInput = z.infer<typeof supplierCreateRequestSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateRequestSchema>;
export type SupplierListInput = z.infer<typeof supplierListQuerySchema>;
