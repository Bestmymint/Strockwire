import { z } from "zod";

import { canonicalEmailSchema } from "./credential-schemas.ts";
import { isOneTimeToken } from "./one-time-token.ts";

export const membershipRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
  "INVENTORY_STAFF",
  "CASHIER",
]);

const uniqueBranchIdsSchema = z
  .array(z.string().uuid())
  .superRefine((branchIds, context) => {
    if (new Set(branchIds).size !== branchIds.length) {
      context.addIssue({
        code: "custom",
        message: "Branch IDs must be unique.",
      });
    }
  });

const expectedUpdatedAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value));

export const organizationMembershipParamsSchema = z
  .object({
    membershipId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

export const organizationInvitationParamsSchema = z
  .object({
    invitationId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

export const invitationCreateRequestSchema = z
  .object({
    branchIds: uniqueBranchIdsSchema.optional().default([]),
    email: canonicalEmailSchema,
    role: membershipRoleSchema,
  })
  .strict();

export const invitationAcceptRequestSchema = z
  .object({ token: z.string().refine(isOneTimeToken) })
  .strict();

export const membershipReplaceRequestSchema = z
  .object({
    branchIds: uniqueBranchIdsSchema.optional().default([]),
    expectedUpdatedAt: expectedUpdatedAtSchema,
    role: membershipRoleSchema,
  })
  .strict();

export const membershipDeactivateRequestSchema = z
  .object({ expectedUpdatedAt: expectedUpdatedAtSchema })
  .strict();

export const managementListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    includeInactive: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  })
  .strict();

export const invitationListQuerySchema = managementListQuerySchema.omit({
  includeInactive: true,
});

export type InvitationCreateInput = z.infer<
  typeof invitationCreateRequestSchema
>;
export type MembershipReplaceInput = z.infer<
  typeof membershipReplaceRequestSchema
>;
