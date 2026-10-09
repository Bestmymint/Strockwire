import type { Request, Response, Route } from "@playwright/test";
import { authBounded } from "../../../apps/api/src/test/auth-integration-lifecycle.ts";

// Outcomes contain no response, cookie, request body, or original exception.
type BrowserOutcome = "delivered" | "canceled" | "transport-failed";
type BrowserEvents = {
  on(event: "response", listener: (response: Response) => void): unknown;
  on(event: "requestfinished", listener: (request: Request) => void): unknown;
  on(event: "requestfailed", listener: (request: Request) => void): unknown;
  off(event: "response", listener: (response: Response) => void): unknown;
  off(event: "requestfinished", listener: (request: Request) => void): unknown;
  off(event: "requestfailed", listener: (request: Request) => void): unknown;
};

export function createDelayedAuthResponse(page: BrowserEvents) {
  const arrived = Promise.withResolvers<number | null>();
  const release = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<BrowserOutcome>();
  const done = Promise.withResolvers<BrowserOutcome | "backend-failed">();
  let original: Request | undefined;
  let backendStatus: number | null = null;
  let browserStatus: number | undefined;
  let calls = 0;
  let completion:
    | Promise<{
        backendStatus: number;
        browserOutcome: "delivered" | "canceled";
      }>
    | undefined;
  const response = (value: Response) => {
    if (value.request() === original) browserStatus = value.status();
  };
  const finished = (request: Request) => {
    if (request === original)
      settled.resolve(
        browserStatus === backendStatus ? "delivered" : "transport-failed",
      );
  };
  const failed = (request: Request) => {
    if (request === original)
      settled.resolve(
        request.failure()?.errorText === "net::ERR_ABORTED"
          ? "canceled"
          : "transport-failed",
      );
  };
  // Observe before the request starts, including cancellation while fulfillment is held.
  page.on("response", response);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  function detach() {
    page.off("response", response);
    page.off("requestfinished", finished);
    page.off("requestfailed", failed);
    original = undefined;
  }
  return {
    async handle(
      route: Pick<Route, "request" | "fetch" | "fulfill" | "abort">,
    ) {
      calls += 1;
      let outcome: BrowserOutcome | "backend-failed" = "backend-failed";
      try {
        original = route.request();
        const response = await authBounded(
          route.fetch({
            timeout: 10_000,
            maxRetries: 0,
            maxRedirects: 0,
          }),
        );
        backendStatus = response.status();
        arrived.resolve(backendStatus);
        outcome = "transport-failed";
        await authBounded(release.promise, 20_000);
        await authBounded(route.fulfill({ response }));
        outcome = await authBounded(settled.promise);
      } catch {
        arrived.resolve(null);
        try {
          await authBounded(route.abort());
        } catch {
          /* Failure is reported by done. */
        }
      } finally {
        detach();
        settled.resolve("transport-failed");
        done.resolve(outcome);
      }
    },
    async status() {
      const status = await authBounded(arrived.promise);
      if (status === null)
        throw new Error(
          "Authentication route backend response failed; details withheld.",
        );
      return status;
    },
    release() {
      release.resolve();
    },
    finish() {
      release.resolve();
      completion ??= (async () => {
        try {
          const outcome = await authBounded(done.promise);
          if (
            outcome === "backend-failed" ||
            outcome === "transport-failed" ||
            backendStatus === null ||
            calls !== 1
          )
            throw new Error(
              `Authentication route completion failed; details withheld. Category: ${outcome}.`,
            );
          return { backendStatus, browserOutcome: outcome };
        } finally {
          detach();
          settled.resolve("transport-failed");
          arrived.resolve(null);
          done.resolve("transport-failed");
        }
      })();
      return completion;
    },
  };
}
