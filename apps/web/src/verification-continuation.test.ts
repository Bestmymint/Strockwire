// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearVerificationContinuation,
  loadVerificationContinuation,
  saveVerificationContinuation,
} from "./verification-continuation";
import type { VerificationContinuation } from "./verification-continuation";

const key = "stockwise_verification_continuation";
const now = 1_800_000_000_000;
const continuation = {
  version: 1,
  canonicalEmail: "person@example.com",
  challengeId: "11111111-1111-4111-8111-111111111111",
  savedAt: now,
} satisfies VerificationContinuation;
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("non-secret verification continuation", () => {
  it("round-trips only the four accepted fields without extending savedAt", () => {
    expect(
      saveVerificationContinuation(sessionStorage, continuation, now + 1000),
    ).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(continuation);
    expect(loadVerificationContinuation(sessionStorage, now + 1000)).toEqual({
      continuation,
      source: "storage",
    });
    clearVerificationContinuation(sessionStorage);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it.each(["password", "code", "token", "proof", "sessionToken"])(
    "refuses to serialize an extra %s credential field",
    (field) => {
      const unsafe = { ...continuation, [field]: "never-persist-this" };
      expect(saveVerificationContinuation(sessionStorage, unsafe, now)).toBe(
        false,
      );
      expect(sessionStorage.getItem(key)).toBeNull();
    },
  );
  it.each([
    "invalid-json",
    "null",
    JSON.stringify({ ...continuation, version: 2 }),
    JSON.stringify({ ...continuation, canonicalEmail: " Person@Example.com " }),
    JSON.stringify({ ...continuation, canonicalEmail: "invalid" }),
    JSON.stringify({ ...continuation, challengeId: "not-a-selector" }),
    JSON.stringify({ ...continuation, password: "must-be-discarded" }),
  ])(
    "removes unusable storage instead of recovering credentials (%s)",
    (raw) => {
      sessionStorage.setItem(key, raw);
      expect(
        loadVerificationContinuation(sessionStorage, now).continuation,
      ).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    },
  );
  it.each([now - 30 * 60_000, now + 1])(
    "rejects the 30-minute boundary and future timestamps (%s)",
    (savedAt) => {
      sessionStorage.setItem(key, JSON.stringify({ ...continuation, savedAt }));
      expect(loadVerificationContinuation(sessionStorage, now).source).toBe(
        "expired",
      );
      expect(sessionStorage.getItem(key)).toBeNull();
    },
  );
  it("allows a null selector without inventing challenge status", () => {
    expect(
      saveVerificationContinuation(
        sessionStorage,
        { ...continuation, challengeId: null },
        now,
      ),
    ).toBe(true);
    expect(
      loadVerificationContinuation(sessionStorage, now).continuation
        ?.challengeId,
    ).toBeNull();
  });
  it("handles unavailable and throwing storage without creating a fallback store", () => {
    expect(loadVerificationContinuation(null, now).source).toBe("unavailable");
    expect(saveVerificationContinuation(null, continuation, now)).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadVerificationContinuation(sessionStorage, now).source).toBe(
      "unavailable",
    );
    expect(
      saveVerificationContinuation(sessionStorage, continuation, now),
    ).toBe(false);
  });
});
