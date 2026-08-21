import { describe, expect, it } from "vitest";

import { loadWebEnvironment, webEnvironmentSchema } from "./environment";

describe("web environment boundary", () => {
  it("starts with no required or exposed configuration", () => {
    expect(loadWebEnvironment()).toEqual({});
  });

  it("rejects unowned values instead of exposing them implicitly", () => {
    expect(() =>
      webEnvironmentSchema.parse({ DATABASE_URL: "must-not-enter-web-config" }),
    ).toThrow();
  });
});
