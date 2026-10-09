import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_INTEGRATION_APPROVAL,
  authIntegrationResources,
  createOwnedAuthDatabase,
  requireAbsentResources,
  requireFreshDatabaseInventory,
  requireOwner,
  validateAuthIntegrationInvocation,
} from "./auth-integration-database.ts";
import { createPrivateVerificationMailbox } from "./auth-integration-mailbox.ts";
import { createVerificationDelivery } from "../modules/identity/verification-delivery.ts";

vi.mock("./database-harness.ts", () => ({
  applyTestDatabaseMigrations: vi.fn(),
  provisionTestDatabase: vi.fn(),
}));

const approved = {
  STOCKWISE_T02A_INTEGRATION_AUTHORIZE: AUTH_INTEGRATION_APPROVAL,
};
const empty = {
  containers: [],
  volumes: [],
  networks: [],
  projectContainers: [],
};
const syntheticEmail = () => `t02a-${randomUUID()}@example.invalid`;
const message = (recipient: string) => ({
  kind: "verification" as const,
  recipient,
  code: "012345",
  url: "http://localhost:3102/verify-email?token=synthetic",
});

describe("private verification mailbox", () => {
  it("uses real post-response dispatch sequencing and compensates an aborted response", async () => {
    const mailbox = createPrivateVerificationMailbox();
    const email = syntheticEmail();
    mailbox.allowAccount(email);
    const canDeliver = vi.fn(async () => true);
    const revokeDelivery = vi.fn(async () => undefined);
    const delivery = createVerificationDelivery({
      emailProvider: mailbox.provider,
      publicWebOrigin: "http://localhost:3102",
      repository: { canDeliver, revokeDelivery },
    });
    const now = new Date();
    const prepared = {
      challenge: {
        id: randomUUID(),
        userId: randomUUID(),
        credentialVersion: 1n,
        otpMac: "a".repeat(64),
        otpKeyId: 1,
        linkTokenHash: "b".repeat(64),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 600_000),
      },
      code: "012345",
      rawLinkToken: "c".repeat(43),
    };
    const reservation = delivery.reserve();
    if (!reservation) throw new Error("Dispatch reservation missing.");
    const response = reservation.prepare({ prepared, recipient: email });
    await expect(mailbox.next(email, 1)).rejects.toThrow(
      "Private verification delivery unavailable.",
    );
    expect(canDeliver).not.toHaveBeenCalled();
    response.finish();
    response.finish();
    expect((await mailbox.next(email)).code === prepared.code).toBe(true);
    const aborted = delivery.reserve();
    if (!aborted) throw new Error("Dispatch reservation missing.");
    aborted
      .prepare({
        prepared: {
          ...prepared,
          challenge: { ...prepared.challenge, id: randomUUID() },
        },
        recipient: email,
      })
      .abort();
    await delivery.drain();
    expect(canDeliver).toHaveBeenCalledTimes(1);
    expect(revokeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "RESPONSE_ABORTED" }),
    );
    await expect(mailbox.next(email, 1)).rejects.toThrow(
      "Private verification delivery unavailable.",
    );
    mailbox.clear();
  });
  it("captures deliveries privately, consumes once and keeps accounts isolated", async () => {
    const mailbox = createPrivateVerificationMailbox();
    const a = syntheticEmail();
    const b = syntheticEmail();
    mailbox.allowAccount(a);
    mailbox.allowAccount(b);
    await mailbox.provider.send(message(a));
    const waiting = mailbox.next(b, 100);
    await mailbox.provider.send(message(b));
    expect((await waiting).recipient === b).toBe(true);
    expect((await mailbox.next(a)).code === "012345").toBe(true);
    await expect(mailbox.next(a, 1)).rejects.toThrow(
      "Private verification delivery unavailable.",
    );
    expect("messages" in mailbox.provider).toBe(false);
    expect(JSON.stringify(mailbox)).not.toContain("012345");
    mailbox.clear();
  });
  it("rejects non-synthetic/unadmitted/aborted delivery without echoing material", async () => {
    const mailbox = createPrivateVerificationMailbox();
    const email = syntheticEmail();
    expect(() => mailbox.allowAccount("real@example.com")).toThrow(
      "Synthetic account admission refused.",
    );
    await expect(mailbox.provider.send(message(email))).rejects.toThrow(
      "Identity email delivery failed.",
    );
    mailbox.allowAccount(email);
    await expect(
      mailbox.provider.send(message(email), AbortSignal.abort()),
    ).rejects.toThrow("Identity email delivery failed.");
    mailbox.clear();
  });
  it("bounds waits and queue capacity, rejects competing waiters and cancels on cleanup", async () => {
    const mailbox = createPrivateVerificationMailbox();
    const email = syntheticEmail();
    mailbox.allowAccount(email);
    await expect(mailbox.next(email, 10_001)).rejects.toThrow(
      "Private delivery wait refused.",
    );
    const pending = mailbox.next(email);
    const rejected = expect(pending).rejects.toThrow(
      "Private verification delivery unavailable.",
    );
    await expect(mailbox.next(email)).rejects.toThrow(
      "Private delivery wait refused.",
    );
    mailbox.releaseAccount(email);
    await rejected;
    mailbox.allowAccount(email);
    for (let index = 0; index < 3; index += 1)
      await mailbox.provider.send(message(email));
    await expect(mailbox.provider.send(message(email))).rejects.toThrow(
      "Identity email delivery failed.",
    );
    mailbox.clear();
    await expect(mailbox.next(email)).rejects.toThrow(
      "Private delivery wait refused.",
    );
    await expect(mailbox.provider.send(message(email))).rejects.toThrow(
      "Identity email delivery failed.",
    );
  });
});

describe("disposable integration ownership gate (no container/database operations)", () => {
  it("refuses a cluster containing any unexpected non-template database", () => {
    expect(() => requireFreshDatabaseInventory(["postgres"])).not.toThrow();
    for (const names of [
      [],
      ["postgres", "stockwise_t02a_auth_test"],
      ["postgres", "stockwise"],
      ["other"],
    ])
      expect(() => requireFreshDatabaseInventory(names)).toThrow(
        "Unexpected existing disposable-cluster databases",
      );
  });
  it("requires separate explicit execution authorization before touching resources", async () => {
    await expect(createOwnedAuthDatabase({})).rejects.toThrow(
      "Separate disposable database execution authorization is required.",
    );
    expect(() => validateAuthIntegrationInvocation(approved)).not.toThrow();
    const harness = await import("./database-harness.ts");
    expect(harness.provisionTestDatabase).not.toHaveBeenCalled();
    expect(harness.applyTestDatabaseMigrations).not.toHaveBeenCalled();
  });
  for (const name of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "STOCKWISE_ALLOW_STOCKWISE_TEST",
    "PGHOST",
    "PGPORT",
    "PGSERVICE",
    "PGOPTIONS",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "COMPOSE_PROJECT_NAME",
    "RESEND_API_KEY",
    "STOCKWISE_EMAIL_PROVIDER",
    "STOCKWISE_POSTGRES_PASSWORD",
    "STOCKWISE_VERIFICATION_PROOF_KEY",
    "PWDEBUG",
    "DEBUG",
    "PLAYWRIGHT_TRACE_DIR",
    "STOCKWISE_T02A_DB_PASSWORD",
    "STOCKWISE_T02A_OWNER",
  ]) {
    it(`rejects inherited ${name} even when empty`, () => {
      expect(() =>
        validateAuthIntegrationInvocation({ ...approved, [name]: "" }),
      ).toThrow(
        "Inherited database, provider, browser-debug, or container configuration refused.",
      );
    });
  }
  it("refuses existing named resources and unexpected Compose project containers", () => {
    const r = authIntegrationResources(randomUUID());
    expect(() => requireAbsentResources(empty, r)).not.toThrow();
    for (const inventory of [
      { ...empty, containers: [r.container] },
      { ...empty, volumes: [r.volume] },
      { ...empty, networks: [r.network] },
      { ...empty, projectContainers: ["unexpected"] },
    ])
      expect(() => requireAbsentResources(inventory, r)).toThrow(
        "Integration resources already exist",
      );
  });
  it("requires the exact current lease token, refusing missing or another run's labels", () => {
    const owner = randomUUID();
    expect(() =>
      requireOwner({ "stockwise.t02a.owner": owner }, owner),
    ).not.toThrow();
    for (const labels of [null, {}, { "stockwise.t02a.owner": randomUUID() }])
      expect(() => requireOwner(labels, owner)).toThrow(
        "ownership cannot be established",
      );
  });
});
