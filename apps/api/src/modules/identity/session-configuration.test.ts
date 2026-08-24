import { describe, expect, it } from "vitest";

import { createSessionConfiguration } from "./session-configuration.ts";

describe("session configuration", () => {
  it("converts configurable minute values and keeps local HTTP usable", () => {
    expect(
      createSessionConfiguration({
        STOCKWISE_RUNTIME_ENV: "development",
        STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: 10_080,
        STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: 1_440,
        STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: 15,
      }),
    ).toEqual({
      absoluteTimeoutMilliseconds: 7 * 24 * 60 * 60 * 1000,
      idleTimeoutMilliseconds: 24 * 60 * 60 * 1000,
      secureCookie: false,
      touchIntervalMilliseconds: 15 * 60 * 1000,
    });
  });

  it("enables Secure cookie mode only for production", () => {
    expect(
      createSessionConfiguration({
        STOCKWISE_RUNTIME_ENV: "production",
        STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: 10_080,
        STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: 1_440,
        STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: 15,
      }).secureCookie,
    ).toBe(true);
    expect(
      createSessionConfiguration({
        STOCKWISE_RUNTIME_ENV: "test",
        STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: 10_080,
        STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: 1_440,
        STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: 15,
      }).secureCookie,
    ).toBe(false);
  });
});
