import { describe, expect, it } from "vitest";

import { apiEnvironmentSchema, loadApiEnvironment } from "./environment.ts";

describe("API environment boundary", () => {
  it("starts with no required or exposed configuration", () => {
    expect(loadApiEnvironment()).toEqual({});
  });

  it("rejects values that the API process does not own yet", () => {
    expect(() =>
      apiEnvironmentSchema.parse({ DATABASE_URL: "must-not-be-accepted-yet" }),
    ).toThrow();
  });
});
