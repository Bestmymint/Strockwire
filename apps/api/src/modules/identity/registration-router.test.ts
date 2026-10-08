import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import {
  createRegistrationLimiter,
  type RegistrationLimiter,
} from "./registration-limiter.ts";
import {
  createRegistrationRouter,
  registrationRequestSchema,
} from "./registration-router.ts";
import type { RegistrationService } from "./registration-service.ts";

interface LogEntry {
  bindings: Record<string, unknown>;
  level: "error" | "info";
  message: string;
}

function createCapturingLogger(): {
  entries: LogEntry[];
  logger: ApiLogger;
} {
  const entries: LogEntry[] = [];

  return {
    entries,
    logger: {
      error(bindings, message) {
        entries.push({ bindings, level: "error", message });
      },
      info(bindings, message) {
        entries.push({ bindings, level: "info", message });
      },
    },
  };
}

describe("registration request validation", () => {
  it("accepts and canonicalizes the required email/password-only request", () => {
    expect(
      registrationRequestSchema.parse({
        email: "  User@Example.COM  ",
        password: "password-long-enough",
      }),
    ).toEqual({
      email: "user@example.com",
      password: "password-long-enough",
    });
  });

  it.each([
    ["malformed email", { email: "not-an-email", password: "x".repeat(15) }],
    ["missing email", { password: "x".repeat(15) }],
    ["missing password", { email: "user@example.com" }],
    [
      "unknown field",
      {
        displayName: "Not accepted during registration",
        email: "user@example.com",
        password: "x".repeat(15),
      },
    ],
  ])("rejects %s", (_name, request) => {
    expect(registrationRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    [14, false],
    [15, true],
    [128, true],
    [129, false],
  ])(
    "validates a %i-code-point password without counting UTF-16 code units",
    (length, accepted) => {
      const result = registrationRequestSchema.safeParse({
        email: "user@example.com",
        password: "🔒".repeat(length),
      });

      expect(result.success).toBe(accepted);
    },
  );

  it("allows whitespace and preserves leading/trailing whitespace and Unicode form", () => {
    const password = `  ${"é".repeat(6)}  `;
    const result = registrationRequestSchema.parse({
      email: "user@example.com",
      password,
    });

    expect(result.password).toBe(password);
    expect(result.password).not.toBe(password.normalize("NFC"));
    expect(
      registrationRequestSchema.safeParse({
        email: "user@example.com",
        password: " ".repeat(15),
      }).success,
    ).toBe(true);
  });
});

function registrationResult() {
  return {
    challengeId: "00000000-0000-4000-8000-000000000001",
    proof: "A".repeat(100),
    expiresAt: new Date(Date.now() + 600_000),
    delivery: null,
  };
}

describe("POST /api/v1/auth/register", () => {
  let runningServer: RunningApiServer | undefined;

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  async function startRegistrationApplication({
    limiter = createRegistrationLimiter(() => 0),
    registrationService,
  }: {
    limiter?: RegistrationLimiter;
    registrationService: RegistrationService;
  }) {
    const captured = createCapturingLogger();
    const apiRouter = createRegistrationRouter({
      limiter,
      registrationService,
      publicWebOrigin: "http://localhost:3000",
    });
    const app = createApp({ apiRouter, logger: captured.logger });
    runningServer = await startApiServer(app, {
      host: "127.0.0.1",
      port: 0,
    });

    return {
      ...captured,
      url: `http://${runningServer.address.host}:${runningServer.address.port}/api/v1/auth/register`,
    };
  }

  function registrationRequest(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        Origin: "http://localhost:3000",
      },
      method: "POST",
    });
  }

  it("returns a safe validation envelope without invoking the limiter or service", async () => {
    const limiter = { consume: vi.fn() };
    const register = vi.fn();
    const { url } = await startRegistrationApplication({
      limiter,
      registrationService: { register },
    });

    const response = await registrationRequest(url, {
      email: "not-an-email",
      password: "short",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request is invalid.",
        requestId: response.headers.get("x-request-id"),
      },
    });
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("shares one limiter key across canonical email variants and returns Retry-After", async () => {
    const register = vi.fn(async () => registrationResult());
    const { url } = await startRegistrationApplication({
      registrationService: { register },
    });
    const emailVariants = [
      "user@example.com",
      " User@example.com",
      "USER@EXAMPLE.COM ",
      " user@EXAMPLE.com ",
      "User@Example.Com",
    ];

    for (const email of emailVariants) {
      const response = await registrationRequest(url, {
        email,
        password: "password-long-enough",
      });
      expect(response.status).toBe(202);
    }

    const limitedResponse = await registrationRequest(url, {
      email: "  USER@example.COM  ",
      password: "password-long-enough",
    });

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("retry-after")).toBe("900");
    expect(await limitedResponse.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many registration attempts. Try again later.",
        requestId: limitedResponse.headers.get("x-request-id"),
      },
    });
    expect(register).toHaveBeenCalledTimes(5);
  });

  it("maps hashing or persistence failures through the safe application envelope", async () => {
    const internalDetail = "postgresql://user:password@database/private";
    const { entries, url } = await startRegistrationApplication({
      registrationService: {
        register: async () => {
          throw new Error(internalDetail);
        },
      },
    });

    const response = await registrationRequest(url, {
      email: "user@example.com",
      password: "password-long-enough",
    });
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: response.headers.get("x-request-id"),
      },
    });
    expect(responseText).not.toContain(internalDetail);
    expect(JSON.stringify(entries)).not.toContain(internalDetail);
  });

  it("preserves safe malformed and oversized request handling", async () => {
    const register = vi.fn();
    const { url } = await startRegistrationApplication({
      registrationService: { register },
    });

    const malformedResponse = await fetch(url, {
      body: '{"email":',
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const oversizedResponse = await registrationRequest(url, {
      email: "user@example.com",
      password: "x".repeat(110 * 1024),
    });

    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(oversizedResponse.status).toBe(413);
    expect(await oversizedResponse.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(register).not.toHaveBeenCalled();
  });
});
