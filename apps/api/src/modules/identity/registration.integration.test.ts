import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { startApiServer, type RunningApiServer } from "../../server.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import {
  createRecordingEmailProvider,
  type IdentityEmailProvider,
} from "./email-provider.ts";
import {
  hashPassword,
  verifyPassword,
  type PasswordHasher,
  type PasswordVerifier,
} from "./password-hasher.ts";
import {
  createIdentityBackendTestFixture,
  TEST_PUBLIC_WEB_ORIGIN,
  type IdentityBackendTestFixture,
} from "../../test/identity-backend-fixture.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const PASSWORD = "  Unicode password é🔒  ";

interface AcceptedBody {
  data: {
    status: string;
    nextStep?: string;
    verification: { challengeId: string };
  };
  meta: { requestId: string };
}

function proofCookie(response: Response) {
  return (
    response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-stockwise_verification_proof="))
      ?.split(";")[0] ?? ""
  );
}

describe("ADR-034 identity backend HTTP cutover", () => {
  let server: RunningApiServer | undefined;
  let fixture: IdentityBackendTestFixture | undefined;
  let origin = "";

  beforeEach(async () => {
    await resetTestDatabase(environment);
  });
  afterEach(async () => {
    await server?.stop();
    await fixture?.delivery.drain();
    server = undefined;
    fixture = undefined;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function start(
    options: {
      emailProvider?: IdentityEmailProvider;
      passwordHasher?: PasswordHasher;
      passwordVerifier?: PasswordVerifier;
    } = {},
  ) {
    const provider = createRecordingEmailProvider();
    fixture = createIdentityBackendTestFixture(prisma, {
      emailProvider: options.emailProvider ?? provider,
      ...options,
    });
    server = await startApiServer(fixture.app, { host: "127.0.0.1", port: 0 });
    origin = `http://${server.address.host}:${server.address.port}/api/v1`;
    return provider;
  }

  function post(
    path: string,
    body: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ) {
    return fetch(`${origin}/auth/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Origin: TEST_PUBLIC_WEB_ORIGIN,
        ...(cookie === undefined ? {} : { Cookie: cookie }),
        ...headers,
      },
    });
  }

  async function register(email = "user@example.com", password = PASSWORD) {
    const response = await post("register", { email, password });
    const body = (await response.json()) as AcceptedBody;
    expect(response.status).toBe(202);
    expect(body).toEqual({
      data: {
        status: "accepted",
        nextStep: "verify_email",
        verification: { challengeId: expect.any(String) },
      },
      meta: { requestId: response.headers.get("x-request-id") },
    });
    return { response, body, cookie: proofCookie(response) };
  }

  it("creates one version-bound pending account, real cookie, OTP/link delivery and no application authority", async () => {
    const provider = await start();
    const registered = await register(" USER@EXAMPLE.COM ");
    await fixture!.delivery.drain();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    const challenge = await prisma.emailVerificationChallenge.findUniqueOrThrow(
      { where: { id: registered.body.data.verification.challengeId } },
    );
    expect(user).toMatchObject({
      credentialVersion: 1n,
      displayName: null,
      emailVerifiedAt: null,
    });
    expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(user.passwordHash, PASSWORD.trim())).toBe(
      false,
    );
    expect(challenge).toMatchObject({
      userId: user.id,
      credentialVersion: 1n,
      failedOtpAttempts: 0,
      isLegacy: false,
      revokedAt: null,
    });
    expect(challenge.expiresAt.getTime() - challenge.issuedAt.getTime()).toBe(
      600_000,
    );
    expect(provider.messages[0]).toMatchObject({
      kind: "verification",
      recipient: user.email,
      code: expect.stringMatching(/^[0-9]{6}$/),
    });
    const cookie = registered.response.headers.getSetCookie()[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    expect(registered.cookie.split("=")[1]).toHaveLength(100);
    expect(registered.response.headers.get("cache-control")).toBe("no-store");
    expect(registered.response.headers.get("referrer-policy")).toBe(
      "no-referrer",
    );
    expect(await prisma.session.count()).toBe(0);
    const protectedRequest = await fetch(`${origin}/protected`, {
      headers: { Cookie: registered.cookie },
    });
    expect(protectedRequest.status).toBe(401);
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.branch.count()).toBe(0);
  });

  it("compensates registration when the response closes before hashing and commit finish", async () => {
    let markHashStarted!: () => void;
    let releaseHash!: () => void;
    let markResponseClosed!: () => void;
    const hashStarted = new Promise<void>((resolve) => {
      markHashStarted = resolve;
    });
    const hashReleased = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const responseClosed = new Promise<void>((resolve) => {
      markResponseClosed = resolve;
    });
    const provider = createRecordingEmailProvider();
    fixture = createIdentityBackendTestFixture(prisma, {
      emailProvider: provider,
      passwordHasher: {
        async hash(password) {
          markHashStarted();
          await hashReleased;
          return hashPassword(password);
        },
      },
    });
    const listener = createServer(fixture.app);
    listener.on("request", (_request, response) =>
      response.once("close", markResponseClosed),
    );
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const address = listener.address();
    if (address === null || typeof address === "string")
      throw new Error("Test listener did not bind a TCP address.");
    server = {
      address: { host: address.address, port: address.port },
      stop: () =>
        new Promise<void>((resolve, reject) => {
          listener.close((error) => (error ? reject(error) : resolve()));
        }),
    };
    origin = `http://127.0.0.1:${address.port}/api/v1`;
    const controller = new AbortController();
    const request = fetch(`${origin}/auth/register`, {
      method: "POST",
      headers: {
        Origin: TEST_PUBLIC_WEB_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "aborted@example.com",
        password: PASSWORD,
      }),
      signal: controller.signal,
    });
    await hashStarted;
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await responseClosed;
    releaseHash();
    await vi.waitFor(
      async () => {
        const challenge = await prisma.emailVerificationChallenge.findFirst();
        expect(challenge?.revocationReason).toBe("RESPONSE_ABORTED");
      },
      { timeout: 5_000 },
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "aborted@example.com" },
    });
    expect(user.credentialVersion).toBe(1n);
    expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);
    expect(provider.messages).toEqual([]);
    expect(await prisma.session.count()).toBe(0);
  });

  it("replaces an admitted pending password/version and rejects predecessor credentials and proof", async () => {
    const provider = await start();
    const old = await register();
    const successor = await register(
      " USER@EXAMPLE.COM ",
      "successor-password-long-enough",
    );
    await fixture!.delivery.drain();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    expect(user.credentialVersion).toBe(2n);
    expect(
      await verifyPassword(user.passwordHash, "successor-password-long-enough"),
    ).toBe(true);
    const predecessor =
      await prisma.emailVerificationChallenge.findUniqueOrThrow({
        where: { id: old.body.data.verification.challengeId },
      });
    expect(predecessor.replacedAt).not.toBeNull();
    // Match the bound OTP rather than depending on concurrent delivery order.
    const latest = await prisma.emailVerificationChallenge.findUniqueOrThrow({
      where: { id: successor.body.data.verification.challengeId },
    });
    const latestMessage = provider.messages.find(
      (item) =>
        item.kind === "verification" &&
        fixture!.security.matchesOtp(
          {
            userId: user.id,
            id: latest.id,
            credentialVersion: 2n,
            otpKeyId: 1,
            otpMac: latest.otpMac!,
          },
          item.code,
        ),
    );
    if (latestMessage?.kind !== "verification")
      throw new Error("Expected successor verification email");
    const stale = await post(
      "verify-email-code",
      { email: user.email, challengeId: latest.id, code: latestMessage.code },
      old.cookie,
    );
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({
      error: { code: "VERIFICATION_PASSWORD_PROOF_REQUIRED" },
    });
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: latest.id },
        })
      ).consumedAt,
    ).toBeNull();
  });

  it("keeps verified and disabled duplicates unchanged with same-sized phantom continuation", async () => {
    await start();
    const passwordHash = await hashPassword(PASSWORD);
    for (const disabled of [false, true]) {
      const email = disabled ? "disabled@example.com" : "verified@example.com";
      const seeded = await prisma.user.create({
        data: {
          email,
          passwordHash,
          emailVerifiedAt: new Date(),
          status: disabled ? "DISABLED" : "ACTIVE",
          disabledAt: disabled ? new Date() : null,
        },
      });
      const duplicate = await register(email, "different-password-long-enough");
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: seeded.id },
      });
      expect(after.passwordHash).toBe(passwordHash);
      expect(after.credentialVersion).toBe(1n);
      expect(after.passwordChangedAt).toEqual(seeded.passwordChangedAt);
      expect(duplicate.cookie.split("=")[1]).toHaveLength(100);
      expect(
        fixture!.security.readProof(duplicate.cookie, new Date())?.usable,
      ).toBe(false);
      expect(
        await prisma.emailVerificationChallenge.count({
          where: { userId: seeded.id },
        }),
      ).toBe(0);
    }
  });

  it("suppresses initial delivery with real proof but preserves pending duplicates once quota is denied", async () => {
    const provider = await start();
    for (let i = 0; i < 3; i++)
      expect(
        (await post("verification-resend", { email: "suppressed@example.com" }))
          .status,
      ).toBe(202);
    const initial = await register("suppressed@example.com");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "suppressed@example.com" },
    });
    const challenge = await prisma.emailVerificationChallenge.findUniqueOrThrow(
      { where: { id: initial.body.data.verification.challengeId } },
    );
    expect(challenge.revocationReason).toBe("DELIVERY_SUPPRESSED");
    expect(challenge.revokedAt).not.toBeNull();
    expect(
      fixture!.security.readProof(initial.cookie, new Date())?.usable,
    ).toBe(true);
    const duplicate = await register(
      user.email,
      "different-password-long-enough",
    );
    expect(
      fixture!.security.readProof(duplicate.cookie, new Date())?.usable,
    ).toBe(false);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ credentialVersion: 1n, passwordHash: user.passwordHash });
    expect(
      await prisma.emailVerificationChallenge.count({
        where: { userId: user.id },
      }),
    ).toBe(1);
    expect(provider.messages).toEqual([]);
  });

  it("compensates failed delivery without undoing installed credentials", async () => {
    await start({
      emailProvider: {
        async send() {
          throw new Error("synthetic provider failure");
        },
      },
    });
    const result = await register();
    await fixture!.delivery.drain();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    expect(user.credentialVersion).toBe(1n);
    expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);
    const challenge = await prisma.emailVerificationChallenge.findUniqueOrThrow(
      { where: { id: result.body.data.verification.challengeId } },
    );
    expect(challenge.revocationReason).toBe("DELIVERY_FAILED");
    expect(challenge.revokedAt).not.toBeNull();
  });

  it("returns pending login proof without session/cookie mutation and fallback never authenticates", async () => {
    await start();
    await register();
    const login = await post(
      "login",
      { email: "user@example.com", password: PASSWORD },
      "stockwise_session=" + "A".repeat(43),
    );
    expect(login.status).toBe(202);
    expect(await login.json()).toMatchObject({
      data: {
        status: "verification_required",
        nextStep: "verify_email",
        verification: { challengeId: expect.any(String) },
      },
    });
    expect(
      login.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("stockwise_session=")),
    ).toBe(false);
    const fallback = await post("verification-password-proof", {
      email: "user@example.com",
      password: PASSWORD,
    });
    expect(fallback.status).toBe(202);
    expect(await fallback.json()).toMatchObject({
      data: { status: "accepted" },
    });
    expect(
      fixture!.security.readProof(proofCookie(fallback), new Date())?.usable,
    ).toBe(true);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.emailVerificationChallenge.count()).toBe(1);
    await prisma.user.update({
      where: { email: "user@example.com" },
      data: { emailVerifiedAt: new Date() },
    });
    const phantom = await post("verification-password-proof", {
      email: "user@example.com",
      password: PASSWORD,
    });
    expect(phantom.status).toBe(202);
    expect(
      fixture!.security.readProof(proofCookie(phantom), new Date())?.usable,
    ).toBe(false);
    expect(await prisma.session.count()).toBe(0);
  });

  it("shares login/fallback failure quota, keeps wrong/missing/disabled responses generic, and does not reset it on success", async () => {
    await start();
    await register();
    for (let i = 0; i < 4; i++) {
      const bad = await post(i % 2 ? "login" : "verification-password-proof", {
        email: "user@example.com",
        password: "wrong-password-long-enough",
      });
      expect(bad.status).toBe(401);
      expect(await bad.json()).toMatchObject({
        error: { code: "INVALID_CREDENTIALS" },
      });
    }
    expect(
      (
        await post("verification-password-proof", {
          email: "user@example.com",
          password: PASSWORD,
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await post("login", {
          email: "user@example.com",
          password: "wrong-password-long-enough",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post("verification-password-proof", {
          email: "user@example.com",
          password: PASSWORD,
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await post("verification-password-proof", {
          email: "missing@example.com",
          password: PASSWORD,
        })
      ).status,
    ).toBe(401);
    await prisma.user.create({
      data: {
        email: "disabled@example.com",
        passwordHash: await hashPassword(PASSWORD),
        status: "DISABLED",
        disabledAt: new Date(),
      },
    });
    expect(
      (
        await post("verification-password-proof", {
          email: "disabled@example.com",
          password: PASSWORD,
        })
      ).status,
    ).toBe(401);
  });

  it("validates mailbox material before proof, counts five wrong codes without proof, then keeps the link usable", async () => {
    const provider = await start();
    const registered = await register();
    await fixture!.delivery.drain();
    const message = provider.messages[0];
    if (message?.kind !== "verification")
      throw new Error("Expected verification email");
    const payload = {
      email: "user@example.com",
      challengeId: registered.body.data.verification.challengeId,
      code: message.code,
    };
    const absent = await post("verify-email-code", payload);
    expect(absent.status).toBe(401);
    expect(await absent.json()).toMatchObject({
      error: { code: "VERIFICATION_PASSWORD_PROOF_REQUIRED" },
    });
    expect(
      await prisma.emailVerificationChallenge.findUniqueOrThrow({
        where: { id: payload.challengeId },
      }),
    ).toMatchObject({ failedOtpAttempts: 0, consumedAt: null });
    const wrong = message.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      const bad = await post("verify-email-code", { ...payload, code: wrong });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({
        error: { code: "INVALID_VERIFICATION_CODE" },
      });
      expect(
        (
          await prisma.emailVerificationChallenge.findUniqueOrThrow({
            where: { id: payload.challengeId },
          })
        ).failedOtpAttempts,
      ).toBe(i + 1);
    }
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: payload.challengeId },
        })
      ).failedOtpAttempts,
    ).toBe(5);
    expect(
      (await post("verify-email-code", payload, registered.cookie)).status,
    ).toBe(400);
    const token = new URL(message.url).searchParams.get("token")!;
    const scanner = await fetch(
      `${origin}/auth/verify-email?token=${encodeURIComponent(token)}`,
      { headers: { Cookie: registered.cookie } },
    );
    expect(scanner.status).toBe(404);
    expect(scanner.headers.getSetCookie()).toEqual([]);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { email: "user@example.com" },
        })
      ).emailVerifiedAt,
    ).toBeNull();
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: payload.challengeId },
        })
      ).consumedAt,
    ).toBeNull();
    const proofRequired = await post("verify-email", { token });
    expect(proofRequired.status).toBe(401);
    const success = await post("verify-email", { token }, registered.cookie);
    expect(success.status).toBe(200);
    expect(success.headers.getSetCookie()[0]).toContain("Max-Age=0");
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: payload.challengeId },
        })
      ).consumedVia,
    ).toBe("LINK");
    expect(
      (await post("verify-email", { token }, registered.cookie)).status,
    ).toBe(400);
    expect(await prisma.session.count()).toBe(0);
  });

  it("atomically consumes OTP once and rejects malformed or duplicate proof cookies without a mailbox oracle", async () => {
    const provider = await start();
    const registered = await register();
    await fixture!.delivery.drain();
    const message = provider.messages[0];
    if (message?.kind !== "verification")
      throw new Error("Expected verification email");
    const payload = {
      email: "user@example.com",
      challengeId: registered.body.data.verification.challengeId,
      code: message.code,
    };
    const duplicate = await post(
      "verify-email-code",
      payload,
      registered.cookie + "; " + registered.cookie,
    );
    expect(duplicate.status).toBe(401);
    const invalid = await post("verify-email", { token: "Z".repeat(43) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "INVALID_TOKEN" },
    });
    const completions = await Promise.all([
      post("verify-email-code", payload, registered.cookie),
      post("verify-email-code", payload, registered.cookie),
    ]);
    expect(completions.map((item) => item.status).sort()).toEqual([200, 400]);
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: payload.challengeId },
        })
      ).consumedVia,
    ).toBe("OTP");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: payload.email } }))
        .emailVerifiedAt,
    ).not.toBeNull();
  });

  it("resend preserves credentials and never changes proof, and invalidates the predecessor", async () => {
    const provider = await start();
    const registered = await register();
    const before = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    const resent = await post(
      "verification-resend",
      { email: before.email },
      registered.cookie,
    );
    expect(resent.status).toBe(202);
    expect(resent.headers.getSetCookie()).toEqual([]);
    await fixture!.delivery.drain();
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.credentialVersion).toBe(1n);
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: registered.body.data.verification.challengeId },
        })
      ).replacedAt,
    ).not.toBeNull();
    expect(provider.messages.some((item) => item.kind === "verification")).toBe(
      true,
    );
  });

  it("rejects missing/null/mismatched Origin, non-JSON and cross-site requests before credential mutations", async () => {
    await start();
    for (const path of [
      "register",
      "login",
      "verification-password-proof",
      "verification-resend",
      "verify-email",
      "verify-email-code",
    ]) {
      const body = { email: "user@example.com", password: PASSWORD };
      for (const badOrigin of ["null", "https://other.example", ""])
        expect(
          (await post(path, body, undefined, { Origin: badOrigin })).status,
        ).toBe(403);
      expect(
        (
          await fetch(`${origin}/auth/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(403);
      expect(
        (await post(path, body, undefined, { "Sec-Fetch-Site": "cross-site" }))
          .status,
      ).toBe(403);
      expect(
        (await post(path, body, undefined, { "Content-Type": "text/plain" }))
          .status,
      ).toBe(403);
    }
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.emailVerificationChallenge.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("fails closed on hashing failure and serializes concurrent canonical registrations", async () => {
    await start({
      passwordHasher: {
        async hash() {
          throw new Error("synthetic hash failure");
        },
      },
    });
    expect(
      (
        await post("register", {
          email: "user@example.com",
          password: PASSWORD,
        })
      ).status,
    ).toBe(500);
    expect(await prisma.user.count()).toBe(0);
    await server!.stop();
    await fixture!.delivery.drain();
    await start();
    const outcomes = await Promise.all([
      register("race@example.com"),
      register(" RACE@EXAMPLE.COM ", "other-password-long-enough"),
    ]);
    expect(outcomes.map((item) => item.response.status)).toEqual([202, 202]);
    expect(
      await prisma.user.count({ where: { email: "race@example.com" } }),
    ).toBe(1);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { email: "race@example.com" },
        })
      ).credentialVersion,
    ).toBe(2n);
    expect(
      await prisma.emailVerificationChallenge.count({
        where: { consumedAt: null, revokedAt: null, replacedAt: null },
      }),
    ).toBe(1);
  });

  it("advances the credential generation even when a pending replacement uses the same plaintext", async () => {
    await start();
    await register();
    const before = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    await register();
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.credentialVersion).toBe(2n);
    expect(after.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(
      before.passwordChangedAt.getTime(),
    );
    expect(await verifyPassword(after.passwordHash, PASSWORD)).toBe(true);
  });

  it("consumes an independently MAC-bound leading-zero OTP", async () => {
    await start();
    const registered = await register();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    await prisma.emailVerificationChallenge.update({
      where: { id: registered.body.data.verification.challengeId },
      data: { replacedAt: new Date() },
    });
    const material = fixture!.security.prepareChallenge(
      user.id,
      1n,
      new Date(),
    );
    const otpMac = createHmac("sha256", Buffer.alloc(32, 11))
      .update(
        [
          "stockwise-verification-otp/v1",
          user.id,
          material.challenge.id,
          "1",
          "000042",
        ].join("\u0000"),
      )
      .digest("hex");
    await prisma.emailVerificationChallenge.create({
      data: { ...material.challenge, otpMac, failedOtpAttempts: 0 },
    });
    const completed = await post(
      "verify-email-code",
      { email: user.email, challengeId: material.challenge.id, code: "000042" },
      registered.cookie,
    );
    expect(completed.status).toBe(200);
    expect(
      (
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: material.challenge.id },
        })
      ).consumedVia,
    ).toBe("OTP");
  });

  it.each(["expired", "revoked", "replaced", "stale_version"] as const)(
    "rejects %s mailbox credentials before the proof oracle or attempt mutation",
    async (state) => {
      const provider = await start();
      const registered = await register();
      await fixture!.delivery.drain();
      const message = provider.messages[0];
      if (message?.kind !== "verification")
        throw new Error("Expected verification delivery.");
      const id = registered.body.data.verification.challengeId;
      const now = Date.now();
      if (state === "expired")
        await prisma.emailVerificationChallenge.update({
          where: { id },
          data: {
            issuedAt: new Date(now - 600_001),
            expiresAt: new Date(now - 1),
          },
        });
      if (state === "revoked")
        await prisma.emailVerificationChallenge.update({
          where: { id },
          data: { revokedAt: new Date(), revocationReason: "DELIVERY_FAILED" },
        });
      if (state === "replaced")
        await prisma.emailVerificationChallenge.update({
          where: { id },
          data: { replacedAt: new Date() },
        });
      if (state === "stale_version")
        await prisma.user.update({
          where: { email: "user@example.com" },
          data: { credentialVersion: { increment: 1 } },
        });
      const code = await post("verify-email-code", {
        email: "user@example.com",
        challengeId: id,
        code: message.code,
      });
      expect(code.status).toBe(400);
      expect(await code.json()).toMatchObject({
        error: { code: "INVALID_VERIFICATION_CODE" },
      });
      const link = await post("verify-email", {
        token: new URL(message.url).searchParams.get("token"),
      });
      expect(link.status).toBe(400);
      expect(await link.json()).toMatchObject({
        error: { code: "INVALID_TOKEN" },
      });
      expect(
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id },
        }),
      ).toMatchObject({ failedOtpAttempts: 0, consumedAt: null });
    },
  );

  it("permits only one success when OTP and link completion race", async () => {
    const provider = await start();
    const registered = await register();
    await fixture!.delivery.drain();
    const message = provider.messages[0];
    if (message?.kind !== "verification")
      throw new Error("Expected verification delivery.");
    const id = registered.body.data.verification.challengeId;
    const results = await Promise.all([
      post(
        "verify-email-code",
        { email: "user@example.com", challengeId: id, code: message.code },
        registered.cookie,
      ),
      post(
        "verify-email",
        { token: new URL(message.url).searchParams.get("token") },
        registered.cookie,
      ),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    const challenge = await prisma.emailVerificationChallenge.findUniqueOrThrow(
      { where: { id } },
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    expect(challenge.consumedAt).toEqual(user.emailVerifiedAt);
    expect(["OTP", "LINK"]).toContain(challenge.consumedVia);
    expect(await prisma.session.count()).toBe(0);
  });

  it("cannot revoke a successor when an older provider call fails after password replacement", async () => {
    const entered = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<void>();
    let sends = 0;
    await start({
      emailProvider: {
        async send() {
          sends += 1;
          if (sends === 1) {
            entered.resolve();
            await failed.promise;
          }
        },
      },
    });
    const predecessor = await register();
    await entered.promise;
    const successor = await register(
      "user@example.com",
      "successor-password-long-enough",
    );
    failed.reject(new Error("Synthetic stale provider failure."));
    await fixture!.delivery.drain();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "user@example.com" },
    });
    expect(user.credentialVersion).toBe(2n);
    expect(
      await verifyPassword(user.passwordHash, "successor-password-long-enough"),
    ).toBe(true);
    expect(
      await prisma.emailVerificationChallenge.findUniqueOrThrow({
        where: { id: predecessor.body.data.verification.challengeId },
      }),
    ).toMatchObject({
      revokedAt: null,
      revocationReason: null,
      replacedAt: expect.any(Date),
    });
    expect(
      await prisma.emailVerificationChallenge.findUniqueOrThrow({
        where: { id: successor.body.data.verification.challengeId },
      }),
    ).toMatchObject({ revokedAt: null, replacedAt: null });
  });

  it("revokes only failed resend material without restoring the predecessor or changing proof", async () => {
    let sends = 0;
    await start({
      emailProvider: {
        async send() {
          sends += 1;
          if (sends === 2) throw new Error("Synthetic resend failure.");
        },
      },
    });
    const registered = await register();
    await vi.waitFor(() => expect(sends).toBe(1));
    const resent = await post(
      "verification-resend",
      { email: "user@example.com" },
      registered.cookie,
    );
    expect(resent.status).toBe(202);
    expect(resent.headers.getSetCookie()).toEqual([]);
    const body = (await resent.json()) as AcceptedBody;
    await fixture!.delivery.drain();
    expect(
      await prisma.emailVerificationChallenge.findUniqueOrThrow({
        where: { id: registered.body.data.verification.challengeId },
      }),
    ).toMatchObject({ replacedAt: expect.any(Date), revokedAt: null });
    expect(
      await prisma.emailVerificationChallenge.findUniqueOrThrow({
        where: { id: body.data.verification.challengeId },
      }),
    ).toMatchObject({
      revocationReason: "DELIVERY_FAILED",
      revokedAt: expect.any(Date),
      credentialVersion: 1n,
    });
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { email: "user@example.com" },
        })
      ).credentialVersion,
    ).toBe(1n);
  });

  it("preserves pending credentials on capacity rejection while admitting a suppressed new account", async () => {
    const provider = await start();
    const user = await prisma.user.create({
      data: {
        email: "pending@example.test",
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const material = fixture!.security.prepareChallenge(
      user.id,
      1n,
      new Date(),
    );
    await prisma.emailVerificationChallenge.create({
      data: { ...material.challenge, failedOtpAttempts: 0 },
    });
    const reservations = Array.from({ length: 32 }, () =>
      fixture!.delivery.reserve(),
    );
    try {
      const duplicate = await register(
        user.email,
        "different-password-long-enough",
      );
      const initial = await register("capacity-new@example.test");
      expect(
        fixture!.security.readProof(duplicate.cookie, new Date())?.usable,
      ).toBe(false);
      expect(
        fixture!.security.readProof(initial.cookie, new Date())?.usable,
      ).toBe(true);
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).toMatchObject({
        passwordHash: user.passwordHash,
        credentialVersion: 1n,
      });
      expect(
        await prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { id: material.challenge.id },
        }),
      ).toMatchObject({ revokedAt: null, replacedAt: null });
      expect(
        (
          await prisma.emailVerificationChallenge.findUniqueOrThrow({
            where: { id: initial.body.data.verification.challengeId },
          })
        ).revocationReason,
      ).toBe("DELIVERY_SUPPRESSED");
      expect(provider.messages).toEqual([]);
    } finally {
      for (const reservation of reservations) reservation?.release();
    }
  });

  it.each(["verified_login", "pending_login", "fallback"] as const)(
    "rejects a concurrent generation change after password demonstration in %s",
    async (mode) => {
      const user = await prisma.user.create({
        data: {
          email: "snapshot@example.test",
          passwordHash: await hashPassword(PASSWORD),
          emailVerifiedAt: mode === "verified_login" ? new Date() : null,
        },
      });
      const demonstrated = Promise.withResolvers<void>();
      const continueAuthority = Promise.withResolvers<void>();
      await start({
        passwordVerifier: {
          async verify(hash, password) {
            const matches = await verifyPassword(hash, password);
            demonstrated.resolve();
            await continueAuthority.promise;
            return matches;
          },
        },
      });
      const pending = post(
        mode === "fallback" ? "verification-password-proof" : "login",
        { email: user.email, password: PASSWORD },
      );
      await demonstrated.promise;
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            credentialVersion: { increment: 1 },
            passwordChangedAt: new Date(),
          },
        });
      } finally {
        continueAuthority.resolve();
      }
      const response = await pending;
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_CREDENTIALS" },
      });
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await prisma.session.count()).toBe(0);
      expect(await prisma.emailVerificationChallenge.count()).toBe(0);
    },
  );
});
