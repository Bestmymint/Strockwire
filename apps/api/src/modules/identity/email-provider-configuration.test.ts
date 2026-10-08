import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdentityEmailProvider } from "./email-provider-configuration.ts";
import { nonDeliveryEmailProvider } from "./email-provider.ts";

describe("identity email provider selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses non-delivery when selected", () => {
    expect(
      createIdentityEmailProvider({
        RESEND_API_KEY: "must-not-be-used",
        STOCKWISE_EMAIL_FROM: "verified@example.com",
        STOCKWISE_EMAIL_PROVIDER: "non_delivery",
      }),
    ).toBe(nonDeliveryEmailProvider);
  });

  it("requires complete Resend configuration", () => {
    expect(() =>
      createIdentityEmailProvider({
        RESEND_API_KEY: undefined,
        STOCKWISE_EMAIL_FROM: undefined,
        STOCKWISE_EMAIL_PROVIDER: "resend",
      }),
    ).toThrow("Resend email configuration is incomplete.");
  });

  it("selects the Resend adapter without outbound I/O", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchImplementation);
    const provider = createIdentityEmailProvider({
      RESEND_API_KEY: "placeholder-key",
      STOCKWISE_EMAIL_FROM: "StockWise <no-reply@example.com>",
      STOCKWISE_EMAIL_PROVIDER: "resend",
    });
    await provider.send({
      kind: "verification",
      recipient: "user@example.com",
      url: "http://localhost:3000/verify-email?token=placeholder",
      code: "001234",
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "https://api.resend.com/emails",
    );
  });
});
