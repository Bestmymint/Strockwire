// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiHealthStatus } from "./api-health-status";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStatus() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ApiHealthStatus />
    </QueryClientProvider>,
  );
}

describe("API health status", () => {
  it("confirms the proxied Express health response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
        ),
    );

    renderStatus();

    expect(
      await screen.findByText("Express API connection verified."),
    ).toBeTruthy();
  });

  it("shows a safe recovery message when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    renderStatus();

    expect(
      await screen.findByText(
        "The Express API connection is unavailable. Start the API development server and refresh this page.",
      ),
    ).toBeTruthy();
  });
});
