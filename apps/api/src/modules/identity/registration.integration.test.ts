import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.ts";
import type { ApiLogger } from "../../logger.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import { startApiServer, type RunningApiServer } from "../../server.ts";
import { argon2PasswordHasher, verifyPassword } from "./password-hasher.ts";
import { createRegistrationLimiter } from "./registration-limiter.ts";
import { createPrismaRegistrationRepository } from "./registration-repository.ts";
import { createRegistrationRouter } from "./registration-router.ts";
import { createRegistrationService } from "./registration-service.ts";

interface LogEntry {
  bindings: Record<string, unknown>;
  level: "error" | "info";
  message: string;
}

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);

describe("registration API with PostgreSQL", () => {
  let runningServer: RunningApiServer | undefined;

  beforeEach(async () => {
    await resetTestDatabase(environment);
  });

  afterEach(async () => {
    await runningServer?.stop();
    runningServer = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await resetTestDatabase(environment);
  });

  async function startRegistrationApplication() {
    const entries: LogEntry[] = [];
    const logger: ApiLogger = {
      error(bindings, message) {
        entries.push({ bindings, level: "error", message });
      },
      info(bindings, message) {
        entries.push({ bindings, level: "info", message });
      },
    };
    const registrationService = createRegistrationService({
      passwordHasher: argon2PasswordHasher,
      repository: createPrismaRegistrationRepository(prisma),
    });
    const apiRouter = createRegistrationRouter({
      limiter: createRegistrationLimiter(),
      registrationService,
    });
    const app = createApp({ apiRouter, logger });
    runningServer = await startApiServer(app, {
      host: "127.0.0.1",
      port: 0,
    });

    return {
      entries,
      url: `http://${runningServer.address.host}:${runningServer.address.port}/api/v1/auth/register`,
    };
  }

  function register(url: string, email: string, password: string) {
    return fetch(url, {
      body: JSON.stringify({ email, password }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }

  it("persists exactly one unverified user with only an exact Argon2 verifier", async () => {
    const password = "  Unicode password é🔒  ";
    const { entries, url } = await startRegistrationApplication();

    const response = await register(url, "  User@Example.COM  ", password);
    const responseText = await response.text();
    const persistedUsers = await prisma.user.findMany();

    expect(response.status).toBe(202);
    expect(JSON.parse(responseText)).toEqual({
      data: { nextStep: "verify_email", status: "accepted" },
      meta: { requestId: response.headers.get("x-request-id") },
    });
    expect(persistedUsers).toHaveLength(1);
    expect(persistedUsers[0]).toMatchObject({
      displayName: null,
      email: "user@example.com",
      emailVerifiedAt: null,
    });
    expect(persistedUsers[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(persistedUsers[0]?.passwordHash ?? "", password),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(persistedUsers[0]?.passwordHash ?? "", password.trim()),
    ).resolves.toBe(false);
    expect(responseText).not.toContain(password);
    expect(JSON.stringify(entries)).not.toContain(password);
    expect(JSON.stringify(entries)).not.toContain(
      persistedUsers[0]?.passwordHash,
    );
    expect(await prisma.emailVerificationToken.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.branch.count()).toBe(0);
  });

  it("returns the same public response for a canonical-email duplicate", async () => {
    const { entries, url } = await startRegistrationApplication();
    const firstResponse = await register(
      url,
      "duplicate@example.com",
      "first-password-long-enough",
    );
    const duplicateResponse = await register(
      url,
      "  DUPLICATE@Example.COM  ",
      "different-password-long-enough",
    );

    expect(firstResponse.status).toBe(202);
    expect(duplicateResponse.status).toBe(202);
    expect(await firstResponse.json()).toEqual({
      data: { nextStep: "verify_email", status: "accepted" },
      meta: { requestId: firstResponse.headers.get("x-request-id") },
    });
    expect(await duplicateResponse.json()).toEqual({
      data: { nextStep: "verify_email", status: "accepted" },
      meta: { requestId: duplicateResponse.headers.get("x-request-id") },
    });
    expect(await prisma.user.count()).toBe(1);
    expect(entries.some((entry) => entry.level === "error")).toBe(false);
    expect(JSON.stringify(entries)).not.toContain("P2002");
    expect(JSON.stringify(entries)).not.toContain("users_email_key");
  });

  it("uses PostgreSQL uniqueness to persist one user under a concurrent duplicate race", async () => {
    const { entries, url } = await startRegistrationApplication();

    const responses = await Promise.all([
      register(url, "concurrent@example.com", "first-password-long-enough"),
      register(url, " CONCURRENT@EXAMPLE.COM ", "second-password-long-enough"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(await prisma.user.count()).toBe(1);
    expect(entries.some((entry) => entry.level === "error")).toBe(false);
    expect(JSON.stringify(entries)).not.toContain("P2002");
  });
});
