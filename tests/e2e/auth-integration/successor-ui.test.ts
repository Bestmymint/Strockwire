import { createServer } from "node:http";
import {
  chromium,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDelayedAuthResponse } from "./safe-route.ts";
import { assertSuccessorOtpUi } from "./successor-ui.ts";
import { en } from "../../../apps/web/src/i18n/en.ts";

let unhandledRejections = 0;
const unhandled = () => {
  unhandledRejections += 1;
};
beforeAll(() => {
  process.on("unhandledRejection", unhandled);
});
afterAll(() => {
  process.off("unhandledRejection", unhandled);
  expect(unhandledRejections).toBe(0);
});

it("Chromium emits main-frame navigation events for History API, traversal and document loads", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("http://127.0.0.1:12345/**", (route) =>
      route.fulfill({ body: "<p>synthetic</p>" }),
    );
    await page.goto("http://127.0.0.1:12345/verify-email");
    const urls: string[] = [];
    const listener = (frame: import("@playwright/test").Frame) => {
      if (frame === page.mainFrame()) urls.push(new URL(frame.url()).pathname);
    };
    page.on("framenavigated", listener);
    for (const operation of [
      "push",
      "replace",
      "back",
      "forward",
      "document",
      "immediate",
    ] as const) {
      urls.length = 0;
      if (operation === "back" || operation === "forward") {
        await page.evaluate(() => {
          history.replaceState(null, "", "/login");
          history.pushState(null, "", "/verify-email");
        });
        urls.length = 0;
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              addEventListener("popstate", () => resolve(), { once: true });
              history.back();
            }),
        );
        if (operation === "forward") {
          urls.length = 0;
          await page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                addEventListener("popstate", () => resolve(), { once: true });
                history.forward();
              }),
          );
        }
      } else if (operation === "document")
        await page.goto("http://127.0.0.1:12345/login");
      else
        await page.evaluate((operation) => {
          if (operation === "replace") history.replaceState(null, "", "/login");
          else history.pushState(null, "", "/login");
          if (operation === "immediate")
            history.replaceState(null, "", "/verify-email");
        }, operation);
      expect(urls, operation).toContain(
        operation === "forward" ? "/verify-email" : "/login",
      );
      if (operation === "immediate" || operation === "forward")
        expect(urls.at(-1)).toBe("/verify-email");
      await page.evaluate(() =>
        history.replaceState(null, "", "/verify-email"),
      );
    }
    page.off("framenavigated", listener);
  } finally {
    await browser.close();
  }
}, 15_000);

for (const path of [
  "verification-resend",
  "verify-email-code",
  "verification-password-proof",
])
  for (const presentation of [
    "clean",
    "error",
    "success",
    "password proof",
    "delayed error",
    "navigation 5 ms",
    "navigation 1 ms",
    "navigation 2 ms",
    "navigation 60 ms",
    "navigation persistent",
    "navigation pushState",
    "navigation replaceState",
    "navigation back",
    "navigation forward",
    "navigation document",
    "subframe navigation",
    "informational message",
    "brief error",
    "observer exception",
    "page closure",
    "settlement navigation",
    "observation timeout",
    "observer setup exception",
    "navigation observer exception",
    "settlement exception",
    "same URL navigation",
    "after-window navigation",
    "late acquisition",
  ] as const)
    it(`successor UI after ${path} settlement: ${presentation}`, async () => {
      const email = "successor@example.invalid";
      const continuation = JSON.stringify({
        version: 1,
        canonicalEmail: email,
        challengeId: "11111111-1111-4111-8111-111111111111",
        savedAt: Date.now(),
      });
      const backendStatus = path === "verify-email-code" ? 200 : 202;
      const server = createServer((request, response) => {
        response.writeHead(request.method === "POST" ? backendStatus : 200, {
          "Content-Type": "text/html",
        });
        response.end(
          request.method === "POST"
            ? "synthetic completion"
            : `<h1>${en.authVerifyTitle}</h1>
                 <form>
                   <p>${en.authVerifyOtpDescription.replace("{email}", email)}</p>
                   <label for="verification-code">${en.authOtpLabel}</label>
                 <input id="verification-code" aria-label="${en.authOtpLabel}" aria-invalid="false">
                   <button type="submit">${en.authVerify}</button>
                 </form>
                 <p role="status">${en.authAccepted}</p>
                 <p role="alert" style="display:none">Hidden synthetic error</p>`,
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Synthetic server unavailable.");
      let browser: Browser | undefined;
      let delayed: ReturnType<typeof createDelayedAuthResponse> | undefined;
      try {
        browser = await chromium.launch();
        const page = await browser.newPage();
        const url = `http://127.0.0.1:${address.port}/verify-email`;
        await page.goto(url);
        await page.evaluate(
          (saved) =>
            sessionStorage.setItem(
              "stockwise_verification_continuation",
              saved,
            ),
          continuation,
        );
        delayed = createDelayedAuthResponse(page);
        await page.route(`**/auth/${path}`, delayed.handle);
        await page.evaluate((path) => {
          void fetch(`/auth/${path}`, { method: "POST" }).catch(
            () => undefined,
          );
        }, path);
        expect(await delayed.status()).toBe(backendStatus);
        expect(await delayed.finish()).toEqual({
          backendStatus,
          browserOutcome: "delivered",
        });
        await page.unrouteAll({ behavior: "wait" });
        expect(await page.getByRole("alert").isVisible()).toBe(false);
        await page.evaluate(
          async ({ presentation, copy }) => {
            function inject() {
              const stale = document.createElement("div");
              if (presentation === "password proof") {
                stale.innerHTML = `<p role="status">${copy.authProofRequired}</p>
                    <label for="proof-password">${copy.authProofPassword}</label>
                    <input id="proof-password" type="password">
                    <button>${copy.authProofSubmit}</button>`;
              } else {
                const message = document.createElement("p");
                message.setAttribute(
                  "role",
                  presentation === "success" ? "status" : "alert",
                );
                message.textContent =
                  presentation === "success"
                    ? copy.authVerified
                    : "Abandoned account A verification failed";
                stale.append(message);
              }
              document.body.append(stale);
            }
            if (presentation === "navigation back") {
              history.replaceState(null, "", "/login");
              history.pushState(null, "", "/verify-email");
            } else if (presentation === "navigation forward") {
              history.pushState(null, "", "/login");
              history.pushState(null, "", "/verify-email");
              await new Promise<void>((resolve) => {
                addEventListener("popstate", () => resolve(), { once: true });
                history.go(-2);
              });
            }
            if (
              presentation.startsWith("navigation ") ||
              presentation === "brief error" ||
              presentation === "informational message" ||
              presentation === "subframe navigation" ||
              presentation === "same URL navigation"
            ) {
              const original = window.setInterval;
              window.setInterval = ((callback: () => void, ms: number) => {
                let navigated = false;
                return original(() => {
                  callback();
                  if (!navigated) {
                    navigated = true;
                    if (presentation === "same URL navigation")
                      history.pushState(null, "", "/verify-email");
                    else if (presentation === "brief error") {
                      const alert = document.createElement("p");
                      alert.setAttribute("role", "alert");
                      alert.textContent = "Synthetic stale error";
                      document.body.append(alert);
                      setTimeout(() => alert.remove(), 1);
                    } else if (presentation === "informational message") {
                      const message = document.createElement("p");
                      message.setAttribute("role", "status");
                      message.textContent = copy.authAccepted;
                      document.body.append(message);
                    } else if (presentation === "subframe navigation") {
                      const frame = document.createElement("iframe");
                      frame.src = "/login";
                      document.body.append(frame);
                    } else if (presentation === "navigation document")
                      location.assign("/login");
                    else if (presentation === "navigation back") {
                      history.back();
                      setTimeout(() => history.forward(), 5);
                    } else if (presentation === "navigation forward") {
                      history.forward();
                      setTimeout(() => history.forward(), 5);
                    } else {
                      if (presentation === "navigation replaceState")
                        history.replaceState(null, "", "/login");
                      else history.pushState(null, "", "/login");
                      if (presentation !== "navigation persistent") {
                        const delay = Number(presentation.split(" ")[1]);
                        setTimeout(
                          () => history.replaceState(null, "", "/verify-email"),
                          Number.isFinite(delay) ? delay : 0,
                        );
                      }
                    }
                  }
                }, ms);
              }) as typeof window.setInterval;
            } else if (presentation === "delayed error")
              setTimeout(inject, 200);
            else if (presentation === "observer exception") {
              Element.prototype.checkVisibility = () => {
                throw new Error("synthetic-private-credential-marker");
              };
            } else if (
              ![
                "clean",
                "page closure",
                "settlement navigation",
                "observation timeout",
                "observer setup exception",
                "settlement exception",
                "after-window navigation",
                "late acquisition",
              ].includes(presentation)
            )
              inject();
          },
          { presentation, copy: en },
        );
        // The former blocks still pass with stale UI beside B's intact OTP form.
        await browserExpect(page).toHaveURL(url);
        await browserExpect(page.getByLabel(en.authOtpLabel)).toBeVisible();
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("stockwise_verification_continuation"),
          ),
        ).toBe(continuation);
        const resources = await page.evaluateHandle((presentation) => {
          const intervals = new Set<number>();
          const deadlines = new Set<number>();
          const pagehideListeners =
            new Set<EventListenerOrEventListenerObject>();
          const addListener = window.addEventListener;
          const removeListener = window.removeEventListener;
          window.addEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
          ) => {
            if (type === "pagehide") pagehideListeners.add(listener);
            addListener.call(window, type, listener, options);
          };
          window.removeEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
          ) => {
            if (type === "pagehide") pagehideListeners.delete(listener);
            removeListener.call(window, type, listener, options);
          };
          let observers = 0;
          const NativeObserver = MutationObserver;
          window.MutationObserver = class extends NativeObserver {
            watching = false;
            override observe(target: Node, options?: MutationObserverInit) {
              if (presentation === "observer setup exception")
                throw new Error("synthetic-private-credential-marker");
              super.observe(target, options);
              if (!this.watching) observers += 1;
              this.watching = true;
            }
            override disconnect() {
              super.disconnect();
              if (this.watching) observers -= 1;
              this.watching = false;
            }
          };
          const interval = window.setInterval;
          const clearInterval = window.clearInterval;
          const timeout = window.setTimeout;
          const clearTimeout = window.clearTimeout;
          window.setInterval = ((
            callback: TimerHandler,
            ms?: number,
            ...args: unknown[]
          ) => {
            const id = interval(callback, ms, ...args);
            if (ms === 25) intervals.add(id);
            return id;
          }) as typeof window.setInterval;
          window.clearInterval = (id) => {
            if (typeof id === "number") intervals.delete(id);
            clearInterval(id);
          };
          window.setTimeout = ((
            callback: TimerHandler,
            ms?: number,
            ...args: unknown[]
          ) => {
            const id = timeout(
              callback,
              presentation === "observation timeout" && ms === 750
                ? 60_000
                : ms,
              ...args,
            );
            if (ms === 750) deadlines.add(id);
            return id;
          }) as typeof window.setTimeout;
          window.clearTimeout = (id) => {
            if (typeof id === "number") deadlines.delete(id);
            clearTimeout(id);
          };
          return {
            counts: () => ({
              intervals: intervals.size,
              deadlines: deadlines.size,
              observers,
              pagehideListeners: pagehideListeners.size,
            }),
          };
        }, presentation);
        let subframeNavigated = false;
        const subframe = (frame: import("@playwright/test").Frame) => {
          if (frame !== page.mainFrame() && frame.url().endsWith("/login"))
            subframeNavigated = true;
        };
        if (presentation === "subframe navigation")
          page.on("framenavigated", subframe);
        const on = vi.spyOn(page, "on");
        const off = vi.spyOn(page, "off");
        let lateDispose: ReturnType<typeof vi.spyOn> | undefined;
        let lateCancel: ReturnType<typeof vi.spyOn> | undefined;
        const acquired = Promise.withResolvers<void>();
        const originalAcquire = page.evaluateHandle.bind(page);
        const lateAcquire =
          presentation === "late acquisition"
            ? vi
                .spyOn(page, "evaluateHandle")
                .mockImplementationOnce(async (fn, arg) => {
                  const handle = await originalAcquire(fn, arg);
                  lateDispose = vi.spyOn(handle, "dispose");
                  lateCancel = vi.spyOn(handle, "evaluate");
                  await new Promise((resolve) => setTimeout(resolve, 2_200));
                  acquired.resolve();
                  return handle;
                })
            : undefined;
        const navigationError =
          presentation === "navigation observer exception"
            ? vi.spyOn(page.mainFrame(), "url").mockImplementation(() => {
                throw new Error("synthetic-private-credential-marker");
              })
            : undefined;
        const started = performance.now();
        let closure: ReturnType<typeof setTimeout> | undefined;
        if (presentation === "page closure")
          closure = setTimeout(() => {
            void page.close().catch(() => undefined);
          }, 100);
        const assertion = assertSuccessorOtpUi(
          page,
          {
            email,
            continuation,
            url,
          },
          presentation === "settlement exception"
            ? async () => {
                throw new Error("synthetic-private-credential-marker");
              }
            : presentation === "settlement navigation"
              ? async () => {
                  await page.evaluate(() => {
                    history.pushState(null, "", "/login");
                    history.replaceState(null, "", "/verify-email");
                  });
                }
              : undefined,
        );
        if (
          [
            "clean",
            "informational message",
            "subframe navigation",
            "same URL navigation",
            "after-window navigation",
          ].includes(presentation)
        ) {
          await expect(assertion).resolves.toBeUndefined();
          expect(performance.now() - started).toBeGreaterThanOrEqual(750);
        } else
          await expect(assertion).rejects.toThrow(
            [
              "observer exception",
              "observer setup exception",
              "navigation observer exception",
              "settlement exception",
              "observation timeout",
              "late acquisition",
            ].includes(presentation)
              ? "Successor OTP UI failed: UI observation failed."
              : presentation === "navigation document"
                ? /^Successor OTP UI failed: (navigation changed|UI observation failed)\.$/
                : presentation.startsWith("navigation ") ||
                    presentation === "settlement navigation"
                  ? "Successor OTP UI failed: navigation changed."
                  : presentation === "page closure"
                    ? "Successor OTP UI failed: page closed."
                    : `Successor OTP UI failed: stale ${
                        presentation === "success"
                          ? "success"
                          : presentation === "password proof"
                            ? "password proof"
                            : "error"
                      }.`,
          );
        clearTimeout(closure);
        if (lateAcquire) {
          await acquired.promise;
          await vi.waitFor(() => {
            expect(lateDispose).toHaveBeenCalledOnce();
          });
          expect(lateCancel).toHaveBeenCalledOnce();
          await lateDispose?.mock.results[0]?.value;
          lateDispose?.mockRestore();
          lateCancel?.mockRestore();
          lateAcquire.mockRestore();
        }
        expect(performance.now() - started).toBeLessThan(4_000);
        for (const event of ["framenavigated", "close"] as const) {
          const registered = on.mock.calls.filter(
            ([name]) => String(name) === event,
          );
          expect(registered).toHaveLength(1);
          expect(off.mock.calls).toContainEqual(registered[0]);
        }
        on.mockRestore();
        off.mockRestore();
        navigationError?.mockRestore();
        if (presentation === "subframe navigation") {
          page.off("framenavigated", subframe);
          expect(subframeNavigated).toBe(true);
        }
        if (!page.isClosed() && presentation !== "navigation document")
          expect(await resources.evaluate((state) => state.counts())).toEqual({
            intervals: 0,
            deadlines: 0,
            observers: 0,
            pagehideListeners: 0,
          });
        await resources.dispose();
        if (
          [
            "navigation 1 ms",
            "navigation 2 ms",
            "navigation 5 ms",
            "navigation 60 ms",
            "navigation pushState",
            "navigation replaceState",
            "navigation back",
            "navigation forward",
            "settlement navigation",
          ].includes(presentation)
        )
          await browserExpect(page).toHaveURL(url);
        if (presentation === "after-window navigation") {
          await page.evaluate(() => history.pushState(null, "", "/login"));
          await expect(assertion).resolves.toBeUndefined();
        }
      } finally {
        delayed?.release();
        if (delayed) await delayed.finish().catch(() => undefined);
        await browser?.close();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }, 15_000);
