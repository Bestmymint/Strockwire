import { describe, expect, it, vi } from "vitest";

import {
  createRecordingEmailProvider,
  createResendEmailProvider,
  EmailDeliveryError,
  nonDeliveryEmailProvider,
} from "./email-provider.ts";

describe("identity email providers", () => {
  it("keeps local non-delivery deterministic and side-effect free", async () => {
    await expect(
      nonDeliveryEmailProvider.send({
        kind: "verification",
        recipient: "user@example.com",
        url: "http://localhost:3000/verify-email?token=sensitive",
      }),
    ).resolves.toBeUndefined();
  });

  it("records deterministic delivery metadata only in the test adapter", async () => {
    const provider = createRecordingEmailProvider();
    const message = {
      kind: "password_reset" as const,
      recipient: "user@example.com",
      url: "http://localhost:3000/reset-password?token=sensitive",
    };

    await provider.send(message);
    expect(provider.messages).toEqual([message]);
  });

  it("sends the minimal Resend request without exposing response details", async () => {
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
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer secret-api-key",
      "Content-Type": "application/json",
    });
    expect(init?.body).toContain("user@example.com");
    expect(init?.body).toContain("sensitive");
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
    ).rejects.toEqual(new EmailDeliveryError());
  });
});
