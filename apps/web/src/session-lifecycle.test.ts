import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { fetchAccessContext } from "@/branch-api-client";
import { discardPrivateSession, privateFetch } from "./session-lifecycle";

afterEach(() => {
  discardPrivateSession(new QueryClient());
  vi.unstubAllGlobals();
});
const access = {
  data: {
    firstOrganizationOnboarding: { eligible: false },
    organizations: [],
    user: {
      id: "30000000-0000-4000-8000-000000000001",
      email: "private@example.test",
      displayName: "Old actor",
    },
  },
};
it("rejects an old actor response even if fetch ignores generation cancellation", async () => {
  const pending = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  const request = fetchAccessContext();
  discardPrivateSession(new QueryClient());
  pending.resolve(new Response(JSON.stringify(access)));
  await expect(request).rejects.toMatchObject({ kind: "unavailable" });
});
it("rejects a delayed parsed access body after the actor generation changed", async () => {
  const pending = Promise.withResolvers<unknown>();
  const response = new Response("{}");
  vi.spyOn(response, "json").mockReturnValue(pending.promise);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const request = fetchAccessContext();
  await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
  discardPrivateSession(new QueryClient());
  pending.resolve(access);
  await expect(request).rejects.toMatchObject({ kind: "unavailable" });
});
it("propagates access-context caller cancellation and rejects its late success", async () => {
  const pending = Promise.withResolvers<Response>();
  let received: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_path: string, options?: RequestInit) => {
      received = options?.signal;
      return pending.promise;
    }),
  );
  const controller = new AbortController();
  const request = fetchAccessContext({ signal: controller.signal });
  controller.abort();
  expect(received?.aborted).toBe(true);
  pending.resolve(new Response(JSON.stringify(access)));
  await expect(request).rejects.toMatchObject({ kind: "unavailable" });
});
it.each([401, 403, 503])(
  "does not turn HTTP %s into authenticated data",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status })),
    );
    await expect(fetchAccessContext()).rejects.toMatchObject({
      kind:
        status === 401
          ? "authentication_required"
          : status === 403
            ? "forbidden"
            : "unavailable",
    });
  },
);
it("does not let cancellation of one request cancel another current request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    privateFetch("/api/v1/me/access-context", { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect((await privateFetch("/api/v1/me/access-context")).status).toBe(200);
});
