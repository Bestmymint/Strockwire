import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiError,
  completeFirstOrganizationOnboarding,
  forgotPassword,
  login,
  register,
  resetPassword,
  resendVerification,
  verifyEmail,
} from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function successfulResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("authentication API client", () => {
  it("posts exact credentials through the same-origin API path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        successfulResponse(
          { nextStep: "verify_email", status: "accepted" },
          202,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const password = "  password with Unicode Ω  ";
    await register({ email: " Person@Example.com ", password });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/register", {
      body: JSON.stringify({ email: " Person@Example.com ", password }),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
    });
  });

  it("validates only safe successful response data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        successfulResponse({
          user: {
            displayName: null,
            email: "person@example.com",
            id: "user-id",
          },
        }),
      ),
    );

    await expect(
      login({ email: "person@example.com", password: "password long enough" }),
    ).resolves.toEqual({
      data: {
        user: { displayName: null, email: "person@example.com", id: "user-id" },
      },
    });
  });

  it("maps rate limiting defensively without exposing raw API text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "RATE_LIMITED", message: "internal detail" },
          }),
          { headers: { "Retry-After": "30" }, status: 429 },
        ),
      ),
    );

    await expect(
      resendVerification({ email: "person@example.com" }),
    ).rejects.toMatchObject({ kind: "rate_limited", retryAfterSeconds: 30 });
  });

  it("rejects malformed and internal response bodies with a safe unavailable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "INTERNAL_ERROR", message: "Prisma secret" },
          }),
          {
            status: 500,
          },
        ),
      ),
    );

    await expect(
      forgotPassword({ email: "person@example.com" }),
    ).rejects.toEqual(new AuthApiError("unavailable"));
  });

  it("sends opaque tokens only in their required request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successfulResponse({ status: "verified" }))
      .mockResolvedValueOnce(successfulResponse({ status: "password_reset" }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyEmail({ token: "opaque-verification-token" });
    await resetPassword({
      newPassword: "  new password with Ω  ",
      token: "opaque-reset-token",
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ token: "opaque-verification-token" }),
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        newPassword: "  new password with Ω  ",
        token: "opaque-reset-token",
      }),
    });
  });

  it("posts only the accepted first-onboarding fields and validates the safe result", async () => {
    const responseData = {
      branch: {
        address: null,
        code: "MAIN",
        id: "branch-id",
        name: "Main",
        phone: null,
      },
      nextStep: "app",
      organization: { id: "organization-id", name: "Store" },
      role: "OWNER",
      user: { displayName: "Owner", id: "user-id", phone: null },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(successfulResponse(responseData));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      branchAddress: "",
      branchName: "Main",
      branchPhone: "",
      displayName: "Owner",
      organizationName: "Store",
      phone: "",
    };

    await expect(completeFirstOrganizationOnboarding(request)).resolves.toEqual(
      { data: responseData },
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/organizations", {
      body: JSON.stringify(request),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
    });
  });

  it("maps first-onboarding conflicts to safe client error kinds", async () => {
    for (const [code, kind] of [
      ["ALREADY_ONBOARDED", "already_onboarded"],
      ["ALREADY_HAS_ORGANIZATION_ACCESS", "already_has_organization_access"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ error: { code } }), { status: 409 }),
          ),
      );

      await expect(
        completeFirstOrganizationOnboarding({
          branchName: "Main",
          displayName: "Owner",
          organizationName: "Store",
        }),
      ).rejects.toMatchObject({ kind });
    }
  });

  it("keeps browser storage and the server-only loopback origin out of auth UI code", () => {
    const sourceRoot = new URL(".", import.meta.url);
    const authSources = [
      new URL("./api-client.ts", sourceRoot),
      new URL("./components/auth/login-form.tsx", sourceRoot),
      new URL("./components/auth/onboarding-form.tsx", sourceRoot),
      new URL("./components/auth/registration-form.tsx", sourceRoot),
      new URL("./components/auth/reset-password-form.tsx", sourceRoot),
      new URL("./components/auth/verification-form.tsx", sourceRoot),
    ].map((url) => readFileSync(fileURLToPath(url), "utf8"));
    const source = authSources.join("\n");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("STOCKWISE_API_ORIGIN");
    expect(source).not.toContain("console.log");
  });
});
