import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import type { RunningApiServer } from "../../server.ts";
import { startApiServer } from "../../server.ts";
import {
  createPasswordResetService as buildPasswordResetService,
  type PasswordResetService,
} from "./credential-lifecycle-service.ts";
import { createBetterAuthPasswordResetRouter } from "./credential-lifecycle-router.ts";
import { secureOneTimeTokenProvider } from "./one-time-token.ts";
import { createEmailRequestLimiter } from "./email-request-limiter.ts";
const publicWebOrigin = "http://localhost:3000";
const logger: ApiLogger = {
  error() {},
  info() {},
};

function createMockPasswordResetService(): PasswordResetService {
  return {
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(true),
  };
}

describe("Better Auth password reset router", () => {
  let runningServer: RunningApiServer | undefined;

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  async function startRouter({
    lifecycleService = createMockPasswordResetService(),
  }: {
    lifecycleService?: PasswordResetService;
  } = {}) {
    const limiter = createEmailRequestLimiter(() => 0);
    const router = createBetterAuthPasswordResetRouter({
      lifecycleService,
      passwordResetLimiter: {
        async consume(email) {
          return limiter.consume(email);
        },
      },
      publicWebOrigin,
    });
    runningServer = await startApiServer(
      createApp({ apiRouter: router, logger }),
      {
        host: "127.0.0.1",
        port: 0,
      },
    );
    return {
      lifecycleService,
      url: `http://${runningServer.address.host}:${runningServer.address.port}/api/v1`,
    };
  }

  function post(
    url: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        Origin: publicWebOrigin,
        ...headers,
      },
      method: "POST",
    });
  }

  it("requires exact same-origin JSON requests before service or limiter work", async () => {
    const { lifecycleService, url } = await startRouter();
    const denied = await Promise.all([
      post(
        url,
        "/auth/forgot-password",
        { email: "person@example.com" },
        {
          origin: "http://localhost:3000/",
        },
      ),
      post(
        url,
        "/auth/forgot-password",
        { email: "person@example.com" },
        {
          origin: "http://attacker.example",
        },
      ),
      post(
        url,
        "/auth/forgot-password",
        { email: "person@example.com" },
        {
          origin: "",
        },
      ),
      post(
        url,
        "/auth/forgot-password",
        { email: "person@example.com" },
        {
          "sec-fetch-site": "cross-site",
        },
      ),
      post(
        url,
        "/auth/reset-password",
        { newPassword: "x".repeat(15), token: "T".repeat(43) },
        {
          "content-type": "text/plain",
        },
      ),
    ]);

    expect(denied.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
    for (const response of denied) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(lifecycleService.requestPasswordReset).not.toHaveBeenCalled();
    expect(lifecycleService.resetPassword).not.toHaveBeenCalled();

    const noOrigin = await fetch(`${url}/auth/forgot-password`, {
      body: JSON.stringify({ email: "person@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(noOrigin.status).toBe(403);
    expect(lifecycleService.requestPasswordReset).not.toHaveBeenCalled();
    expect(
      (
        await post(url, "/auth/forgot-password", {
          email: "person@example.com",
        })
      ).status,
    ).toBe(202);
    expect(lifecycleService.requestPasswordReset).toHaveBeenCalledTimes(1);
  });

  it("returns identical generic acceptance for missing, eligible, and provider-failure outcomes", async () => {
    const envelopes: unknown[] = [];
    const providerFailure = vi.fn();
    const cases = [
      {
        email: "missing@example.com",
        provider: { async send() {} },
        issue: async () => null,
      },
      {
        email: "eligible@example.com",
        provider: { async send() {} },
        issue: async () => ({
          id: "eligible-token",
          recipient: "eligible@example.com",
        }),
      },
      {
        email: "failure@example.com",
        provider: {
          async send() {
            providerFailure();
            throw new Error("provider unavailable");
          },
        },
        issue: async () => ({
          id: "failure-token",
          recipient: "failure@example.com",
        }),
      },
    ];

    for (const outcome of cases) {
      const repository = {
        completePasswordReset: vi.fn().mockResolvedValue(true),
        findValidPasswordResetToken: vi.fn().mockResolvedValue(null),
        issuePasswordResetToken: vi.fn(outcome.issue),
        revokePasswordResetToken: vi.fn().mockResolvedValue(undefined),
      };
      const lifecycleService = buildPasswordResetService({
        emailProvider: outcome.provider,
        passwordHasher: { hash: vi.fn().mockResolvedValue("unused") },
        publicWebOrigin,
        repository,
        tokenProvider: secureOneTimeTokenProvider,
      });
      const { url } = await startRouter({ lifecycleService });
      const response = await post(url, "/auth/forgot-password", {
        email: outcome.email,
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      envelopes.push(body);
      expect(body).toEqual({
        data: { status: "accepted" },
        meta: { requestId: expect.any(String) },
      });
      expect(JSON.stringify(body)).not.toContain(outcome.email);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(repository.issuePasswordResetToken).toHaveBeenCalledWith(
        expect.objectContaining({ email: outcome.email }),
      );
      await runningServer?.stop();
      runningServer = undefined;
    }

    expect(providerFailure).toHaveBeenCalledTimes(1);
    expect(envelopes).toEqual(
      Array.from({ length: 3 }, () => ({
        data: { status: "accepted" },
        meta: { requestId: expect.any(String) },
      })),
    );
  });

  it("preserves password code-point bounds and exact whitespace", async () => {
    const { lifecycleService, url } = await startRouter();
    const token = "T".repeat(43);

    for (const newPassword of ["x".repeat(14), "x".repeat(129)]) {
      expect(
        (await post(url, "/auth/reset-password", { newPassword, token }))
          .status,
      ).toBe(400);
    }
    expect(lifecycleService.resetPassword).not.toHaveBeenCalled();

    for (const newPassword of [
      "🔒".repeat(15),
      "🔒".repeat(128),
      "  password value  ",
    ]) {
      const response = await post(url, "/auth/reset-password", {
        newPassword,
        token,
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({
        data: { status: "password_reset" },
      });
      expect(lifecycleService.resetPassword).toHaveBeenLastCalledWith({
        newPassword,
        rawToken: token,
      });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(body).not.toContain(token);
      expect(body).not.toContain(newPassword);
      expect(body).toContain('"status":"password_reset"');
    }
  });

  it("does not call reset authority for malformed tokens and keeps unknown tokens generic", async () => {
    const { lifecycleService, url } = await startRouter();
    const malformed = await post(url, "/auth/reset-password", {
      newPassword: "x".repeat(15),
      token: "not-a-token",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request is invalid.",
      },
    });
    expect(lifecycleService.resetPassword).not.toHaveBeenCalled();

    vi.mocked(lifecycleService.resetPassword).mockResolvedValueOnce(false);
    const unknownToken = "U".repeat(43);
    const unknown = await post(url, "/auth/reset-password", {
      newPassword: "x".repeat(15),
      token: unknownToken,
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.clone().json()).toMatchObject({
      error: {
        code: "INVALID_TOKEN",
        message: "The token is invalid or expired.",
      },
    });
    expect(await unknown.text()).not.toContain(unknownToken);
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it("keeps service failures safe and successful responses free of credentials or session state", async () => {
    const password = "  private password  ";
    const token = "S".repeat(43);
    const lifecycleService = createMockPasswordResetService();
    vi.mocked(lifecycleService.resetPassword).mockRejectedValueOnce(
      new Error(`provider failure ${password} ${token}`),
    );
    const { url } = await startRouter({ lifecycleService });
    const failed = await post(url, "/auth/reset-password", {
      newPassword: password,
      token,
    });
    const failureBody = await failed.text();
    expect(failed.status).toBe(500);
    expect(failureBody).not.toContain(password);
    expect(failureBody).not.toContain(token);
    expect(failed.headers.get("set-cookie")).toBeNull();

    const successful = await post(url, "/auth/reset-password", {
      newPassword: password,
      token,
    });
    expect(successful.status).toBe(200);
    const body = await successful.text();
    expect(body).not.toContain(password);
    expect(body).not.toContain(token);
    expect(body).not.toContain("session");
    expect(successful.headers.get("set-cookie")).toBeNull();
  });

  it("enforces the existing forgot-password rate budget and exposes reset routes only", async () => {
    const { lifecycleService, url } = await startRouter();
    const responses = [];
    for (let index = 0; index < 4; index += 1) {
      responses.push(
        await post(url, "/auth/forgot-password", {
          email: "budget@example.com",
        }),
      );
    }
    expect(responses.map((response) => response.status)).toEqual([
      202, 202, 202, 429,
    ]);
    const limited = responses.at(3);
    if (limited === undefined) throw new Error("Missing rate-limit response");
    expect(limited.headers.get("retry-after")).toBe("900");
    expect(await limited.json()).toMatchObject({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again later.",
      },
    });
    expect(lifecycleService.requestPasswordReset).toHaveBeenCalledTimes(3);

    for (const path of [
      "/auth/logout",
      "/auth/logout-all",
      "/auth/verification-resend",
      "/auth/verify-email",
      "/auth/verify-email-code",
    ]) {
      expect((await post(url, path, {})).status).toBe(404);
    }
  });
});
