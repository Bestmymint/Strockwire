import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchApiHealth } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API health client boundary", () => {
  it("uses the same-origin health path and validates the operational response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchApiHealth()).resolves.toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      headers: { accept: "application/json" },
    });
  });

  it("rejects an unavailable or malformed operational response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(fetchApiHealth()).rejects.toThrow(
      "The API health check was unavailable.",
    );

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: "ready" }), { status: 200 }),
        ),
    );
    await expect(fetchApiHealth()).rejects.toThrow();
  });
});
