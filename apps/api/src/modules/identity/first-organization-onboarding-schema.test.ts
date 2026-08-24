import { describe, expect, it } from "vitest";

import {
  firstOrganizationOnboardingRequestSchema,
  hashFirstOrganizationOnboardingRequest,
} from "./first-organization-onboarding-schema.ts";

describe("first organization onboarding request", () => {
  it("trims boundaries, preserves internal whitespace and Unicode, and nulls blank optional values", () => {
    const decomposedName = "Cafe\u0301  Retail";
    const parsed = firstOrganizationOnboardingRequestSchema.parse({
      branchAddress: "   ",
      branchName: "  Main  Branch  ",
      branchPhone: "  +66 2 000 0000  ",
      displayName: `  ${decomposedName}  `,
      organizationName: "  ร้าน  ตัวอย่าง  ",
      phone: "",
    });

    expect(parsed).toEqual({
      branchAddress: null,
      branchName: "Main  Branch",
      branchPhone: "+66 2 000 0000",
      displayName: decomposedName,
      organizationName: "ร้าน  ตัวอย่าง",
      phone: null,
    });
    expect(parsed.displayName).not.toBe("Café  Retail");
  });

  it("rejects whitespace-only required values, length overflow, and unknown fields", () => {
    const valid = {
      branchName: "Main",
      displayName: "Owner",
      organizationName: "Organization",
    };

    for (const field of [
      "displayName",
      "organizationName",
      "branchName",
    ] as const) {
      expect(
        firstOrganizationOnboardingRequestSchema.safeParse({
          ...valid,
          [field]: "   ",
        }).success,
      ).toBe(false);
    }
    expect(
      firstOrganizationOnboardingRequestSchema.safeParse({
        ...valid,
        branchAddress: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      firstOrganizationOnboardingRequestSchema.safeParse({
        ...valid,
        role: "OWNER",
      }).success,
    ).toBe(false);
  });

  it("hashes one deterministic canonical representation", () => {
    const first = firstOrganizationOnboardingRequestSchema.parse({
      branchAddress: " ",
      branchName: " Main ",
      displayName: " Owner ",
      organizationName: " Store ",
      phone: " ",
    });
    const second = firstOrganizationOnboardingRequestSchema.parse({
      branchName: "Main",
      displayName: "Owner",
      organizationName: "Store",
    });

    expect(hashFirstOrganizationOnboardingRequest(first)).toBe(
      hashFirstOrganizationOnboardingRequest(second),
    );
    expect(hashFirstOrganizationOnboardingRequest(first)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
