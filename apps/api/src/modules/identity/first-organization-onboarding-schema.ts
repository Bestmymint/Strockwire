import { createHash } from "node:crypto";

import { z } from "zod";

function requiredText(maximumLength: number) {
  return z.string().trim().min(1).max(maximumLength);
}

function optionalText(maximumLength: number) {
  return z
    .string()
    .trim()
    .max(maximumLength)
    .transform((value) => (value === "" ? null : value))
    .optional()
    .transform((value) => value ?? null);
}

export const firstOrganizationOnboardingRequestSchema = z
  .object({
    displayName: requiredText(200),
    phone: optionalText(32),
    organizationName: requiredText(200),
    branchName: requiredText(200),
    branchPhone: optionalText(32),
    branchAddress: optionalText(500),
  })
  .strict();

export type FirstOrganizationOnboardingInput = z.infer<
  typeof firstOrganizationOnboardingRequestSchema
>;

export function hashFirstOrganizationOnboardingRequest(
  input: FirstOrganizationOnboardingInput,
): string {
  const serialized = JSON.stringify({
    displayName: input.displayName,
    phone: input.phone,
    organizationName: input.organizationName,
    branchName: input.branchName,
    branchPhone: input.branchPhone,
    branchAddress: input.branchAddress,
  });

  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
