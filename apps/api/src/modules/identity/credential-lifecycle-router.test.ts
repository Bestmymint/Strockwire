import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import type { CredentialLifecycleService } from "./credential-lifecycle-service.ts";
import { createCredentialLifecycleRouter } from "./credential-lifecycle-router.ts";
import { createEmailRequestLimiter } from "./email-request-limiter.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import { SESSION_COOKIE_NAME } from "./session-cookie.ts";

const configuration: SessionConfiguration = {
  absoluteTimeoutMilliseconds: 7 * 24 * 60 * 60 * 1000,
  idleTimeoutMilliseconds: 24 * 60 * 60 * 1000,
  secureCookie: false,
  touchIntervalMilliseconds: 15 * 60 * 1000,
};
const logger: ApiLogger = {
  error() {},
  info() {},
};

function createLifecycleService(): CredentialLifecycleService {
  return {
    logoutAll: vi.fn().mockResolvedValue(undefined),
    logoutCurrent: vi.fn().mockResolvedValue(undefined),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    requestVerification: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(true),
    verifyEmail: vi.fn().mockResolvedValue(true),
  };
}

describe("credential lifecycle router", () => {
  let runningServer: RunningApiServer | undefined;

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  async function startRouter({
    lifecycleService = createLifecycleService(),
    now = () => 1_000,
  }: {
    lifecycleService?: CredentialLifecycleService;
    now?: () => number;
  } = {}) {
    const apiRouter = createCredentialLifecycleRouter({
      authenticationMiddleware: (_request, response) => {
        response.status(401).end();
      },
      configuration,
      lifecycleService,
      passwordResetLimiter: createEmailRequestLimiter(now),
      publicWebOrigin: "http://localhost:3000",
      verificationResendLimiter: createEmailRequestLimiter(now),
    });
    runningServer = await startApiServer(createApp({ apiRouter, logger }), {
      host: "127.0.0.1",
      port: 0,
    });
    return {
      lifecycleService,
      url: `http://${runningServer.address.host}:${runningServer.address.port}/api/v1`,
    };
  }

  function post(url: string, path: string, body: unknown, headers = {}) {
    return fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    });
  }

  it("shares the verification limit across canonical variants", async () => {
    const { lifecycleService, url } = await startRouter();
    const responses = [];
    for (const email of [
      " User@Example.com ",
      "user@example.com",
      "USER@EXAMPLE.COM",
      "user@example.com",
    ]) {
      responses.push(await post(url, "/auth/verification-resend", { email }));
    }

    expect(responses.map((response) => response.status)).toEqual([
      202, 202, 202, 429,
    ]);
    expect(responses[3]?.headers.get("retry-after")).toBe("900");
    expect(lifecycleService.requestVerification).toHaveBeenCalledTimes(3);
    expect(lifecycleService.requestVerification).toHaveBeenNthCalledWith(
      1,
      "user@example.com",
    );
  });

  it("does not allocate verification limiter state for malformed email", async () => {
    const { url } = await startRouter();

    expect(
      (await post(url, "/auth/verification-resend", { email: "invalid" }))
        .status,
    ).toBe(400);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        (
          await post(url, "/auth/verification-resend", {
            email: "user@example.com",
          })
        ).status,
      ).toBe(202);
    }
  });

  it("applies an independent reset-request fixed window and restores it", async () => {
    let now = 5_000;
    const { url } = await startRouter({ now: () => now });

    for (const email of [
      " RESET@EXAMPLE.COM ",
      "reset@example.com",
      "Reset@example.com",
    ]) {
      expect((await post(url, "/auth/forgot-password", { email })).status).toBe(
        202,
      );
    }
    const limited = await post(url, "/auth/forgot-password", {
      email: "reset@example.com",
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");

    now += 15 * 60 * 1000;
    expect(
      (
        await post(url, "/auth/forgot-password", {
          email: "reset@example.com",
        })
      ).status,
    ).toBe(202);
  });

  it("enforces the accepted reset-password boundaries before service work", async () => {
    const { lifecycleService, url } = await startRouter();
    const token = "T".repeat(43);

    for (const newPassword of ["x".repeat(14), "x".repeat(129)]) {
      expect(
        (await post(url, "/auth/reset-password", { newPassword, token }))
          .status,
      ).toBe(400);
    }
    expect(lifecycleService.resetPassword).not.toHaveBeenCalled();

    expect(
      (
        await post(url, "/auth/reset-password", {
          newPassword: "  Unicode pass 🔒  ",
          token,
        })
      ).status,
    ).toBe(200);
    expect(lifecycleService.resetPassword).toHaveBeenCalledWith({
      newPassword: "  Unicode pass 🔒  ",
      rawToken: token,
    });
  });

  it("clears missing or random sessions and fails safely on repository error", async () => {
    const lifecycleService = createLifecycleService();
    const { url } = await startRouter({ lifecycleService });

    const missing = await post(url, "/auth/logout", {});
    const random = await post(
      url,
      "/auth/logout",
      {},
      { cookie: `${SESSION_COOKIE_NAME}=${"R".repeat(43)}` },
    );
    expect([missing.status, random.status]).toEqual([204, 204]);
    expect(missing.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(random.headers.get("set-cookie")).toContain("HttpOnly");

    vi.mocked(lifecycleService.logoutCurrent).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const failure = await post(
      url,
      "/auth/logout",
      {},
      { cookie: `${SESSION_COOKIE_NAME}=${"S".repeat(43)}` },
    );
    expect(failure.status).toBe(500);
    expect(failure.headers.get("set-cookie")).toBeNull();
    expect(await failure.text()).not.toContain("database unavailable");
  });

  it("rejects cross-site logout before session work", async () => {
    const { lifecycleService, url } = await startRouter();
    const response = await post(
      url,
      "/auth/logout",
      {},
      {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    );

    expect(response.status).toBe(403);
    expect(lifecycleService.logoutCurrent).not.toHaveBeenCalled();
  });
});
