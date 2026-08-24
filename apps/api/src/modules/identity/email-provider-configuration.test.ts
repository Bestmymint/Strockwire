import { describe, expect, it } from "vitest";

import { createIdentityEmailProvider } from "./email-provider-configuration.ts";
import { nonDeliveryEmailProvider } from "./email-provider.ts";

describe("identity email provider selection", () => {
  it.each(["development", "test"] as const)(
    "uses non-delivery in %s even when credentials are present",
    (runtime) => {
      expect(
        createIdentityEmailProvider({
          RESEND_API_KEY: "must-not-be-used",
          STOCKWISE_EMAIL_FROM: "verified@example.com",
          STOCKWISE_RUNTIME_ENV: runtime,
        }),
      ).toBe(nonDeliveryEmailProvider);
    },
  );

  it("requires complete production Resend configuration", () => {
    expect(() =>
      createIdentityEmailProvider({
        RESEND_API_KEY: undefined,
        STOCKWISE_EMAIL_FROM: undefined,
        STOCKWISE_RUNTIME_ENV: "production",
      }),
    ).toThrow("Production email configuration is incomplete.");
    expect(
      createIdentityEmailProvider({
        RESEND_API_KEY: "server-only-key",
        STOCKWISE_EMAIL_FROM: "verified@example.com",
        STOCKWISE_RUNTIME_ENV: "production",
      }),
    ).not.toBe(nonDeliveryEmailProvider);
  });
});
