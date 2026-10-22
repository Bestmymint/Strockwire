import { describe, expect, it, vi } from "vitest";

import {
  createResendEmailProvider,
  EmailDeliveryError,
} from "./email-provider.ts";

describe("identity email providers", () => {
  it("preserves a leading-zero OTP and usable secure link in verification delivery", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "provider-id" }), { status: 200 }),
      );
    const provider = createResendEmailProvider({
      apiKey: "secret-api-key",
      fetchImplementation,
      from: "StockWise <verified@example.com>",
    });

    await provider.send({
      kind: "verification",
      recipient: "user@example.com",
      url: "https://app.example.com/verify-email?token=sensitive",
      code: "001234",
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const payload: unknown = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({ text: expect.stringContaining("001234") });
    expect(payload).toMatchObject({
      text: expect.stringContaining(
        "https://app.example.com/verify-email?token=sensitive",
      ),
    });
  });

  it("maps provider and network failures to one secret-free error", async () => {
    const provider = createResendEmailProvider({
      apiKey: "secret-api-key",
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("raw provider secret detail", { status: 503 }),
        ),
      from: "verified@example.com",
    });

    await expect(
      provider.send({
        kind: "password_reset",
        recipient: "user@example.com",
        url: "https://app.example.com/reset-password?token=sensitive",
      }),
    ).rejects.toMatchObject({
      name: "EmailDeliveryError",
      category: "provider_http",
      httpStatus: 503,
      message: "Identity email delivery failed.",
    });
  });

  it.each([
    ["network", new Error("sensitive network response")],
    ["timeout", new DOMException("sensitive timeout response", "TimeoutError")],
  ] as const)(
    "classifies %s without exposing the underlying exception",
    async (category, error) => {
      const provider = createResendEmailProvider({
        apiKey: "sensitive-api-key",
        fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(error),
        from: "verified@example.com",
      });
      try {
        await provider.send({
          kind: "verification",
          recipient: "user@example.com",
          url: "https://app.example.com/verify-email?token=sensitive",
          code: "123456",
        });
        throw new Error("Expected provider failure");
      } catch (failure) {
        expect(failure).toBeInstanceOf(EmailDeliveryError);
        expect(failure).toMatchObject({
          category,
          message: "Identity email delivery failed.",
        });
        expect(JSON.stringify(failure)).not.toContain("sensitive");
      }
    },
  );
});
