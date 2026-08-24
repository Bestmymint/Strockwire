import { Router } from "express";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { createPrismaAuthenticationSessionRepository } from "./authentication-repository.ts";
import { createAuthenticationMiddleware } from "./authentication-context.ts";
import { createPrismaCredentialLifecycleRepository } from "./credential-lifecycle-repository.ts";
import { createCredentialLifecycleRouter } from "./credential-lifecycle-router.ts";
import { createCredentialLifecycleService } from "./credential-lifecycle-service.ts";
import { createEmailRequestLimiter } from "./email-request-limiter.ts";
import {
  createRecordingEmailProvider,
  type IdentityEmailProvider,
} from "./email-provider.ts";
import {
  argon2PasswordHasher,
  hashPassword,
  verifyPassword,
  type PasswordHasher,
} from "./password-hasher.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import { SESSION_COOKIE_NAME } from "./session-cookie.ts";
import { hashSessionToken } from "./session-token.ts";
import {
  hashOneTimeToken,
  secureOneTimeTokenProvider,
} from "./one-time-token.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const NOW = new Date("2026-08-24T12:00:00.000Z");
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const configuration: SessionConfiguration = {
  absoluteTimeoutMilliseconds: 7 * DAY_MILLISECONDS,
  idleTimeoutMilliseconds: DAY_MILLISECONDS,
  secureCookie: false,
  touchIntervalMilliseconds: 15 * 60 * 1000,
};

interface LogEntry {
  bindings: Record<string, unknown>;
  level: "error" | "info";
  message: string;
}

afterAll(async () => {
  await resetTestDatabase(environment);
  await prisma.$disconnect();
});

describe("credential lifecycle with PostgreSQL", () => {
  let runningServer: RunningApiServer | undefined;

  beforeEach(async () => {
    await resetTestDatabase(environment);
  });

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  async function seedUser({
    email = "user@example.com",
    verified = true,
  }: {
    email?: string;
    verified?: boolean;
  } = {}) {
    return prisma.user.create({
      data: {
        displayName: null,
        email,
        emailVerifiedAt: verified ? new Date(NOW.getTime() - 1_000) : null,
        passwordHash: await hashPassword("current-password-long-enough"),
      },
    });
  }

  async function seedSession(userId: string, token: string, issuedAt = NOW) {
    return prisma.session.create({
      data: {
        absoluteExpiresAt: new Date(issuedAt.getTime() + 7 * DAY_MILLISECONDS),
        idleExpiresAt: new Date(issuedAt.getTime() + DAY_MILLISECONDS),
        issuedAt,
        lastUsedAt: issuedAt,
        tokenHash: hashSessionToken(token),
        userId,
      },
    });
  }

  async function startApplication({
    emailProvider = createRecordingEmailProvider(),
    now = () => NOW,
    passwordHasher = argon2PasswordHasher,
  }: {
    emailProvider?: IdentityEmailProvider;
    now?: () => Date;
    passwordHasher?: PasswordHasher;
  } = {}) {
    const entries: LogEntry[] = [];
    const logger: ApiLogger = {
      error(bindings, message) {
        entries.push({ bindings, level: "error", message });
      },
      info(bindings, message) {
        entries.push({ bindings, level: "info", message });
      },
    };
    const repository = createPrismaCredentialLifecycleRepository(prisma);
    const authenticationMiddleware = createAuthenticationMiddleware({
      configuration,
      now,
      repository: createPrismaAuthenticationSessionRepository(prisma),
    });
    const lifecycleService = createCredentialLifecycleService({
      emailProvider,
      now,
      onDeliveryFailure(kind) {
        entries.push({
          bindings: { deliveryType: kind },
          level: "error",
          message: "identity email delivery failed",
        });
      },
      passwordHasher,
      publicWebOrigin: "http://localhost:3000",
      repository,
      tokenProvider: secureOneTimeTokenProvider,
    });
    const apiRouter = Router();
    apiRouter.use(
      createCredentialLifecycleRouter({
        authenticationMiddleware,
        configuration,
        lifecycleService,
        passwordResetLimiter: createEmailRequestLimiter(),
        publicWebOrigin: "http://localhost:3000",
        verificationResendLimiter: createEmailRequestLimiter(),
      }),
    );
    apiRouter.get(
      "/protected",
      authenticationMiddleware,
      (_request, response) => {
        response.status(200).json({ status: "authenticated" });
      },
    );
    runningServer = await startApiServer(createApp({ apiRouter, logger }), {
      host: "127.0.0.1",
      port: 0,
    });

    return {
      emailProvider,
      entries,
      url: `http://${runningServer.address.host}:${runningServer.address.port}/api/v1`,
    };
  }

  function post(url: string, path: string, body: unknown, cookie?: string) {
    return fetch(`${url}${path}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(cookie === undefined ? {} : { cookie }),
      },
      method: "POST",
    });
  }

  function deliveredToken(
    provider: ReturnType<typeof createRecordingEmailProvider>,
    index = -1,
  ) {
    const message = provider.messages.at(index);
    if (message === undefined) {
      throw new Error("Expected a recorded identity email.");
    }
    const token = new URL(message.url).searchParams.get("token");
    if (token === null) {
      throw new Error("Expected an opaque token in the recorded link.");
    }
    return token;
  }

  it("issues, replaces, consumes, and rejects replayed verification tokens", async () => {
    const user = await seedUser({ verified: false });
    const provider = createRecordingEmailProvider();
    const { url } = await startApplication({ emailProvider: provider });

    expect(
      (await post(url, "/auth/verification-resend", { email: user.email }))
        .status,
    ).toBe(202);
    const firstRawToken = deliveredToken(provider);
    expect(
      (await post(url, "/auth/verification-resend", { email: user.email }))
        .status,
    ).toBe(202);
    const secondRawToken = deliveredToken(provider);
    const records = await prisma.emailVerificationToken.findMany({
      orderBy: { createdAt: "asc" },
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ replacedAt: NOW, userId: user.id });
    expect(records[1]).toMatchObject({
      expiresAt: new Date(NOW.getTime() + DAY_MILLISECONDS),
      replacedAt: null,
      userId: user.id,
    });
    expect(records[0]?.tokenHash).toBe(hashOneTimeToken(firstRawToken));
    expect(records[1]?.tokenHash).toBe(hashOneTimeToken(secondRawToken));
    expect(JSON.stringify(records)).not.toContain(firstRawToken);
    expect(
      (await post(url, "/auth/verify-email", { token: firstRawToken })).status,
    ).toBe(400);
    expect(
      (await post(url, "/auth/verify-email", { token: secondRawToken })).status,
    ).toBe(200);
    expect(
      (await post(url, "/auth/verify-email", { token: secondRawToken })).status,
    ).toBe(400);
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({ emailVerifiedAt: NOW });
  });

  it("rejects expired, revoked, and random verification tokens", async () => {
    const user = await seedUser({ verified: false });
    const expired = "E".repeat(43);
    const revoked = "V".repeat(43);
    await prisma.emailVerificationToken.createMany({
      data: [
        {
          expiresAt: new Date(NOW.getTime() - 1),
          issuedAt: new Date(NOW.getTime() - DAY_MILLISECONDS),
          tokenHash: hashOneTimeToken(expired),
          userId: user.id,
        },
        {
          expiresAt: new Date(NOW.getTime() + DAY_MILLISECONDS),
          issuedAt: new Date(NOW.getTime() - 1_000),
          revokedAt: NOW,
          tokenHash: hashOneTimeToken(revoked),
          userId: user.id,
        },
      ],
    });
    const { url } = await startApplication();

    for (const token of [expired, revoked, "R".repeat(43)]) {
      expect((await post(url, "/auth/verify-email", { token })).status).toBe(
        400,
      );
    }
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({ emailVerifiedAt: null });
  });

  it("keeps provider failures generic while consuming all resend attempts", async () => {
    await seedUser({ verified: false });
    await seedUser({ email: "reset@example.com" });
    const provider: IdentityEmailProvider = {
      send: vi.fn().mockRejectedValue(new Error("raw provider detail")),
    };
    const { entries, url } = await startApplication({
      emailProvider: provider,
    });

    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(
        await post(url, "/auth/verification-resend", {
          email: "user@example.com",
        }),
      );
    }
    expect(responses.map((response) => response.status)).toEqual([
      202, 202, 202, 429,
    ]);
    expect(responses[3]?.headers.get("retry-after")).toBe("900");
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(
      await prisma.emailVerificationToken.count({
        where: { revokedAt: { not: null } },
      }),
    ).toBe(3);

    const resetResponses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      resetResponses.push(
        await post(url, "/auth/forgot-password", {
          email: "reset@example.com",
        }),
      );
    }
    expect(resetResponses.map((response) => response.status)).toEqual([
      202, 202, 202, 429,
    ]);
    expect(resetResponses[3]?.headers.get("retry-after")).toBe("900");
    expect(provider.send).toHaveBeenCalledTimes(6);
    expect(
      await prisma.passwordResetToken.count({
        where: { revokedAt: { not: null } },
      }),
    ).toBe(3);
    expect(JSON.stringify(entries)).not.toContain("raw provider detail");
  });

  it("counts eligible, missing, and ineligible emails identically before lookup", async () => {
    await seedUser({ email: "unverified@example.com", verified: false });
    await seedUser({ email: "verified@example.com" });
    const provider = createRecordingEmailProvider();
    const { url } = await startApplication({ emailProvider: provider });

    for (const email of [
      "unverified@example.com",
      "missing@example.com",
      "verified@example.com",
    ]) {
      const statuses = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        statuses.push(
          (
            await post(url, "/auth/verification-resend", {
              email: attempt === 0 ? ` ${email.toUpperCase()} ` : email,
            })
          ).status,
        );
      }
      expect(statuses).toEqual([202, 202, 202, 429]);
    }
    expect(
      provider.messages.filter((message) => message.kind === "verification"),
    ).toHaveLength(3);

    for (const email of ["verified@example.com", "missing-reset@example.com"]) {
      const statuses = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        statuses.push(
          (
            await post(url, "/auth/forgot-password", {
              email: attempt === 0 ? ` ${email.toUpperCase()} ` : email,
            })
          ).status,
        );
      }
      expect(statuses).toEqual([202, 202, 202, 429]);
    }
    expect(
      provider.messages.filter((message) => message.kind === "password_reset"),
    ).toHaveLength(3);
  });

  it("keeps reset-request responses account-safe and replaces prior tokens", async () => {
    await seedUser();
    const provider = createRecordingEmailProvider();
    const { url } = await startApplication({ emailProvider: provider });

    const existing = await post(url, "/auth/forgot-password", {
      email: " USER@EXAMPLE.COM ",
    });
    const missing = await post(url, "/auth/forgot-password", {
      email: "missing@example.com",
    });
    expect([existing.status, missing.status]).toEqual([202, 202]);
    const existingBody = (await existing.json()) as {
      data: { status: string };
    };
    const missingBody = (await missing.json()) as {
      data: { status: string };
    };
    expect(existingBody.data).toEqual(missingBody.data);
    expect(provider.messages).toHaveLength(1);

    const firstToken = deliveredToken(provider);
    expect(
      (
        await post(url, "/auth/forgot-password", {
          email: "user@example.com",
        })
      ).status,
    ).toBe(202);
    const records = await prisma.passwordResetToken.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ replacedAt: NOW });
    expect(records[1]).toMatchObject({
      expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      replacedAt: null,
    });
    expect(records[0]?.tokenHash).toBe(hashOneTimeToken(firstToken));
  });

  it("resets the password and revokes every user session atomically", async () => {
    const user = await seedUser();
    const other = await seedUser({ email: "other@example.com" });
    const firstSessionToken = "A".repeat(43);
    const secondSessionToken = "B".repeat(43);
    await seedSession(user.id, firstSessionToken);
    await seedSession(user.id, secondSessionToken);
    const otherSession = await seedSession(other.id, "C".repeat(43));
    const provider = createRecordingEmailProvider();
    const { entries, url } = await startApplication({
      emailProvider: provider,
    });
    await post(url, "/auth/forgot-password", { email: user.email });
    const rawResetToken = deliveredToken(provider);
    const newPassword = "  new Unicode password 🔒  ";

    const response = await post(url, "/auth/reset-password", {
      newPassword,
      token: rawResetToken,
    });
    expect(response.status).toBe(200);
    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(await verifyPassword(updatedUser.passwordHash, newPassword)).toBe(
      true,
    );
    expect(updatedUser.passwordHash).not.toBe(newPassword);
    expect(updatedUser.passwordChangedAt).toEqual(NOW);
    expect(await prisma.passwordResetToken.findFirst()).toMatchObject({
      consumedAt: NOW,
    });
    expect(
      await prisma.session.findMany({
        where: { userId: user.id },
        orderBy: { tokenHash: "asc" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revocationReason: "password_reset",
          revokedAt: NOW,
        }),
        expect.objectContaining({
          revocationReason: "password_reset",
          revokedAt: NOW,
        }),
      ]),
    );
    expect(
      await prisma.session.findUnique({ where: { id: otherSession.id } }),
    ).toMatchObject({ revokedAt: null });
    expect(await prisma.session.count()).toBe(3);
    expect(
      (
        await fetch(`${url}/protected`, {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${firstSessionToken}`,
          },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post(url, "/auth/reset-password", {
          newPassword: "another-password-long-enough",
          token: rawResetToken,
        })
      ).status,
    ).toBe(400);
    expect(JSON.stringify(entries)).not.toContain(newPassword);
    expect(JSON.stringify(entries)).not.toContain(rawResetToken);
  });

  it("rejects invalid reset states before Argon2 and rolls back transaction failure", async () => {
    const user = await seedUser();
    const provider = createRecordingEmailProvider();
    const passwordHasher: PasswordHasher = {
      hash: vi.fn(argon2PasswordHasher.hash),
    };
    const { url } = await startApplication({
      emailProvider: provider,
      passwordHasher,
    });

    await post(url, "/auth/forgot-password", { email: user.email });
    const first = deliveredToken(provider);
    await post(url, "/auth/forgot-password", { email: user.email });
    const active = deliveredToken(provider);
    const expired = "X".repeat(43);
    await prisma.passwordResetToken.create({
      data: {
        expiresAt: new Date(NOW.getTime() - 1),
        issuedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        tokenHash: hashOneTimeToken(expired),
        userId: user.id,
      },
    });
    expect(
      (
        await post(url, "/auth/reset-password", {
          newPassword: "replacement-password-long-enough",
          token: first,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(url, "/auth/reset-password", {
          newPassword: "replacement-password-long-enough",
          token: expired,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(url, "/auth/reset-password", {
          newPassword: "replacement-password-long-enough",
          token: "R".repeat(43),
        })
      ).status,
    ).toBe(400);
    expect(passwordHasher.hash).not.toHaveBeenCalled();

    const originalUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const futureIssuedAt = new Date(NOW.getTime() + 60 * 60 * 1000);
    const futureSession = await seedSession(
      user.id,
      "F".repeat(43),
      futureIssuedAt,
    );
    const failure = await post(url, "/auth/reset-password", {
      newPassword: "replacement-password-long-enough",
      token: active,
    });
    expect(failure.status).toBe(500);
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({ passwordHash: originalUser.passwordHash });
    expect(
      await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashOneTimeToken(active) },
      }),
    ).toMatchObject({ consumedAt: null });
    expect(
      await prisma.session.findUnique({ where: { id: futureSession.id } }),
    ).toMatchObject({ revokedAt: null });
  });

  it("serializes concurrent token replacement and permits one reset completion", async () => {
    const user = await seedUser({ verified: false });
    const provider = createRecordingEmailProvider();
    const { url } = await startApplication({ emailProvider: provider });
    const resends = await Promise.all([
      post(url, "/auth/verification-resend", { email: user.email }),
      post(url, "/auth/verification-resend", { email: user.email }),
    ]);
    expect(resends.map((response) => response.status)).toEqual([202, 202]);
    expect(
      await prisma.emailVerificationToken.count({
        where: { consumedAt: null, replacedAt: null, revokedAt: null },
      }),
    ).toBe(1);

    const activeVerification = provider.messages.at(-1);
    if (activeVerification === undefined) {
      throw new Error("Expected a verification message.");
    }
    const verificationToken = new URL(activeVerification.url).searchParams.get(
      "token",
    );
    if (verificationToken === null) {
      throw new Error("Expected a verification token.");
    }
    const verifications = await Promise.all([
      post(url, "/auth/verify-email", { token: verificationToken }),
      post(url, "/auth/verify-email", { token: verificationToken }),
    ]);
    expect(verifications.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);

    const resetProvider = createRecordingEmailProvider();
    await runningServer?.stop();
    runningServer = undefined;
    const secondApp = await startApplication({ emailProvider: resetProvider });
    await post(secondApp.url, "/auth/forgot-password", { email: user.email });
    const resetToken = deliveredToken(resetProvider);
    const completions = await Promise.all([
      post(secondApp.url, "/auth/reset-password", {
        newPassword: "first-concurrent-password",
        token: resetToken,
      }),
      post(secondApp.url, "/auth/reset-password", {
        newPassword: "second-concurrent-password",
        token: resetToken,
      }),
    ]);
    expect(completions.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect(
      await prisma.passwordResetToken.count({
        where: { consumedAt: { not: null } },
      }),
    ).toBe(1);
  });

  it("revokes current and all sessions without affecting another user", async () => {
    const user = await seedUser();
    const other = await seedUser({ email: "other@example.com" });
    const currentToken = "L".repeat(43);
    const secondToken = "M".repeat(43);
    const current = await seedSession(user.id, currentToken);
    const second = await seedSession(user.id, secondToken);
    const otherSession = await seedSession(other.id, "N".repeat(43));
    const expiredToken = "O".repeat(43);
    const expiredSession = await prisma.session.create({
      data: {
        absoluteExpiresAt: new Date(NOW.getTime() + DAY_MILLISECONDS),
        idleExpiresAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        issuedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
        lastUsedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
        tokenHash: hashSessionToken(expiredToken),
        userId: user.id,
      },
    });
    const { url } = await startApplication();

    const logout = await post(
      url,
      "/auth/logout",
      {},
      `${SESSION_COOKIE_NAME}=${currentToken}`,
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      await prisma.session.findUnique({ where: { id: current.id } }),
    ).toMatchObject({ revocationReason: "logout", revokedAt: NOW });
    expect(
      (
        await fetch(`${url}/protected`, {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${currentToken}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          url,
          "/auth/logout",
          {},
          `${SESSION_COOKIE_NAME}=${currentToken}`,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await post(
          url,
          "/auth/logout",
          {},
          `${SESSION_COOKIE_NAME}=${expiredToken}`,
        )
      ).status,
    ).toBe(204);
    expect(
      await prisma.session.findUnique({ where: { id: expiredSession.id } }),
    ).toMatchObject({ revocationReason: "logout", revokedAt: NOW });

    const logoutAll = await post(
      url,
      "/auth/logout-all",
      {},
      `${SESSION_COOKIE_NAME}=${secondToken}`,
    );
    expect(logoutAll.status).toBe(204);
    expect(
      await prisma.session.findUnique({ where: { id: second.id } }),
    ).toMatchObject({ revocationReason: "logout_all", revokedAt: NOW });
    expect(
      await prisma.session.findUnique({ where: { id: otherSession.id } }),
    ).toMatchObject({ revokedAt: null });
  });
});
