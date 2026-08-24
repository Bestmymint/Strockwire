import { describe, expect, it } from "vitest";

import { createLoginLimiter } from "./login-limiter.ts";

describe("login limiter", () => {
  it("processes five failures and limits the next attempt for the fixed window", () => {
    let currentTime = 0;
    const limiter = createLoginLimiter(() => currentTime);

    for (let failure = 0; failure < 5; failure += 1) {
      expect(limiter.check("user@example.com")).toEqual({ allowed: true });
      limiter.recordCredentialFailure("user@example.com");
    }

    expect(limiter.check("user@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });

    currentTime = 60_001;
    expect(limiter.check("user@example.com")).toEqual({
      allowed: false,
      retryAfterSeconds: 840,
    });
  });

  it("restores attempts only after the fixed window expires", () => {
    let currentTime = 1_000;
    const limiter = createLoginLimiter(() => currentTime);

    for (let failure = 0; failure < 5; failure += 1) {
      limiter.recordCredentialFailure("user@example.com");
    }

    currentTime += 15 * 60 * 1000;

    expect(limiter.check("user@example.com")).toEqual({ allowed: true });
    limiter.recordCredentialFailure("user@example.com");
    expect(limiter.check("user@example.com")).toEqual({ allowed: true });
  });

  it("keeps independent canonical-email entries without storing caller-visible keys", () => {
    const limiter = createLoginLimiter(() => 0);

    for (let failure = 0; failure < 5; failure += 1) {
      limiter.recordCredentialFailure("first@example.com");
    }

    expect(limiter.check("first@example.com").allowed).toBe(false);
    expect(limiter.check("second@example.com")).toEqual({ allowed: true });
  });
});
