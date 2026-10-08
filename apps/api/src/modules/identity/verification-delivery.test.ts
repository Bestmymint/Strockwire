import { afterEach, describe, expect, it, vi } from "vitest";

import { createVerificationDelivery } from "./verification-delivery.ts";
import { testVerificationSecurity } from "../../test/identity-backend-fixture.ts";

const prepared = testVerificationSecurity().prepare(
  "00000000-0000-4000-8000-000000000001",
  1n,
  new Date(),
);
const publicWebOrigin = "http://localhost:3000";

afterEach(() => vi.useRealTimers());

describe("verification dispatch admission and response lifecycle", () => {
  it("bounds outstanding reservations to 32 and releases exactly once", () => {
    const delivery = createVerificationDelivery({
      publicWebOrigin,
      emailProvider: { async send() {} },
      repository: { canDeliver: async () => true, async revokeDelivery() {} },
    });
    const reservations = Array.from({ length: 32 }, () => delivery.reserve());
    expect(reservations.every((item) => item !== null)).toBe(true);
    expect(delivery.reserve()).toBeNull();
    reservations[0]!.release();
    reservations[0]!.release();
    const replacement = delivery.reserve();
    expect(replacement).not.toBeNull();
    expect(delivery.reserve()).toBeNull();
    for (const reservation of reservations) reservation?.release();
    replacement?.release();
  });

  it("does not send before response completion and skips known stale jobs", async () => {
    let sent = 0;
    const delivery = createVerificationDelivery({
      publicWebOrigin,
      emailProvider: {
        async send() {
          sent += 1;
        },
      },
      repository: {
        canDeliver: async () => false,
        async revokeDelivery() {
          throw new Error("Stale dispatch does not compensate a successor");
        },
      },
    });
    const response = delivery
      .reserve()!
      .prepare({ prepared, recipient: "user@example.com" });
    expect(sent).toBe(0);
    response.finish();
    response.finish();
    await delivery.drain();
    expect(sent).toBe(0);
  });

  it("aborts unsent response-bound delivery and revokes only the exact challenge", async () => {
    let sent = 0;
    const revocations: { challengeId: string; reason: string }[] = [];
    const delivery = createVerificationDelivery({
      publicWebOrigin,
      emailProvider: {
        async send() {
          sent += 1;
        },
      },
      repository: {
        canDeliver: async () => true,
        async revokeDelivery(input) {
          revocations.push(input);
        },
      },
    });
    const response = delivery
      .reserve()!
      .prepare({ prepared, recipient: "user@example.com" });
    response.abort();
    response.abort();
    response.finish();
    await delivery.drain();
    expect(sent).toBe(0);
    expect(revocations).toEqual([
      { challengeId: prepared.challenge.id, reason: "RESPONSE_ABORTED" },
    ]);
  });

  it("times out after ten seconds without retry and releases capacity after exact compensation", async () => {
    vi.useFakeTimers();
    let sent = 0;
    let aborted = false;
    const revocations: { challengeId: string; reason: string }[] = [];
    const delivery = createVerificationDelivery({
      publicWebOrigin,
      emailProvider: {
        send(_message, signal) {
          sent += 1;
          return new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("Synthetic aborted provider"));
              },
              { once: true },
            );
          });
        },
      },
      repository: {
        canDeliver: async () => true,
        async revokeDelivery(input) {
          revocations.push(input);
        },
      },
    });
    const response = delivery
      .reserve()!
      .prepare({ prepared, recipient: "user@example.com" });
    response.finish();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sent).toBe(1);
    expect(aborted).toBe(false);
    expect(revocations).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(sent).toBe(1);
    expect(revocations).toEqual([
      { challengeId: prepared.challenge.id, reason: "DELIVERY_FAILED" },
    ]);
    const reservations = Array.from({ length: 32 }, () => delivery.reserve());
    expect(reservations.every((item) => item !== null)).toBe(true);
    for (const reservation of reservations) reservation?.release();
    await delivery.drain();
    expect(delivery.reserve()).toBeNull();
  });

  it("bounds shutdown drain and never starts provider I/O after its deadline", async () => {
    vi.useFakeTimers();
    let resolveEligibility!: (value: boolean) => void;
    const eligibility = new Promise<boolean>((resolve) => {
      resolveEligibility = resolve;
    });
    let sent = 0;
    const revocations: { challengeId: string; reason: string }[] = [];
    const delivery = createVerificationDelivery({
      publicWebOrigin,
      emailProvider: {
        async send() {
          sent += 1;
        },
      },
      repository: {
        canDeliver: () => eligibility,
        async revokeDelivery(input) {
          revocations.push(input);
        },
      },
    });
    delivery
      .reserve()!
      .prepare({ prepared, recipient: "user@example.com" })
      .finish();
    const drained = delivery.drain();
    await vi.advanceTimersByTimeAsync(10_000);
    await drained;
    resolveEligibility(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toBe(0);
    expect(revocations).toEqual([
      { challengeId: prepared.challenge.id, reason: "DELIVERY_FAILED" },
    ]);
    expect(delivery.reserve()).toBeNull();
  });

  it("drains reservations awaiting response completion and refuses late provider starts", async () => {
    vi.useFakeTimers();
    let sent = 0;
    const revocations: { challengeId: string; reason: string }[] = [];
    const delivery = createVerificationDelivery({
      publicWebOrigin,
      emailProvider: {
        async send() {
          sent += 1;
        },
      },
      repository: {
        canDeliver: async () => true,
        async revokeDelivery(input) {
          revocations.push(input);
        },
      },
    });
    const response = delivery
      .reserve()!
      .prepare({ prepared, recipient: "user@example.com" });
    let completed = false;
    const drained = delivery.drain().then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await drained;
    response.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toBe(0);
    expect(revocations).toEqual([
      { challengeId: prepared.challenge.id, reason: "DELIVERY_FAILED" },
    ]);
  });
});
