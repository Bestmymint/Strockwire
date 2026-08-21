import { describe, expect, it } from "vitest";

import { getApiHealthRewrite } from "./api-proxy";

describe("web-to-API development proxy", () => {
  it("keeps the browser health request same-origin while targeting loopback Express", () => {
    expect(
      getApiHealthRewrite({ STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" }),
    ).toEqual({
      destination: "http://127.0.0.1:3001/health",
      source: "/api/health",
    });
  });
});
