import { describe, expect, it } from "vitest";

import { getApiHealthRewrite, getApiV1Rewrite } from "./api-proxy";

describe("web-to-API development proxy", () => {
  it("keeps the browser health request same-origin while targeting loopback Express", () => {
    expect(
      getApiHealthRewrite({ STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" }),
    ).toEqual({
      destination: "http://127.0.0.1:3001/health",
      source: "/api/health",
    });
  });

  it("proxies Express-owned business API requests without exposing its origin", () => {
    expect(
      getApiV1Rewrite({ STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" }),
    ).toEqual({
      destination: "http://127.0.0.1:3001/api/v1/:path*",
      source: "/api/v1/:path*",
    });
  });
});
