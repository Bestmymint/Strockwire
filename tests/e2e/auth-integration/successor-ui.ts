import type { Frame, Page } from "@playwright/test";
import { en } from "../../../apps/web/src/i18n/en.ts";
import { authBounded } from "../../../apps/api/src/test/auth-integration-lifecycle.ts";

export async function assertSuccessorOtpUi(
  page: Page,
  successor: { email: string; continuation: string | null; url: string },
  settle?: () => Promise<void>,
) {
  let failure: string | null = null;
  let observing = true;
  const navigated = (frame: Frame) => {
    if (!observing) return;
    try {
      if (frame === page.mainFrame() && frame.url() !== successor.url)
        failure ??= "navigation changed";
    } catch {
      failure ??= "UI observation failed";
    }
  };
  const closed = () => {
    if (observing) failure ??= "page closed";
  };
  // Attach before releasing the abandoned response; a return to B cannot clear a departure.
  try {
    page.on("framenavigated", navigated);
    page.on("close", closed);
    if (settle) await authBounded(settle());
    const acquisition = page.evaluateHandle(
      ({ successor, copy }) => {
        const result = Promise.withResolvers<string | null>();
        let observer: MutationObserver | undefined;
        let poll: number | undefined;
        let deadline: number | undefined;
        let finished = false;
        const visible = (element: Element) =>
          element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          });
        const shown = (selector: string) =>
          [...document.querySelectorAll(selector)].filter(visible);
        const hasText = (text: string) =>
          shown("p, button").some((element) => element.textContent === text);
        function inspect() {
          if (location.href !== successor.url) return "navigation changed";
          const saved = sessionStorage.getItem(
            "stockwise_verification_continuation",
          );
          if (saved === null || saved !== successor.continuation)
            return "continuation changed";
          const continuation = JSON.parse(saved);
          if (
            continuation.canonicalEmail !== successor.email ||
            continuation.version !== 1 ||
            typeof continuation.challengeId !== "string" ||
            continuation.challengeId.length === 0
          )
            return "continuation identity invalid";
          if (shown('[role="alert"]').length > 0) return "stale error";
          if (hasText(copy.authVerified) || hasText(copy.authResendAccepted))
            return "stale success";
          if (
            shown("#proof-password").length > 0 ||
            hasText(copy.authProofRequired) ||
            hasText(copy.authProofSubmit)
          )
            return "stale password proof";
          if (
            !hasText(
              copy.authVerifyOtpDescription.replace("{email}", successor.email),
            )
          )
            return "account identity changed";
          const otp =
            document.querySelector<HTMLInputElement>("#verification-code");
          const form = otp?.closest("form");
          const verify = form?.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
          );
          if (
            !otp ||
            !visible(otp) ||
            otp.getAttribute("aria-label") !== copy.authOtpLabel ||
            otp.disabled ||
            otp.value !== "" ||
            otp.getAttribute("aria-invalid") === "true" ||
            !verify ||
            !visible(verify) ||
            verify.disabled ||
            verify.textContent !== copy.authVerify ||
            hasText(copy.loading) ||
            hasText(copy.authVerifying) ||
            hasText(copy.authRecovery) ||
            hasText(copy.authNoChallenge)
          )
            return "OTP form not ready";
          return null;
        }
        function check() {
          let failure: string | null;
          try {
            failure = inspect();
          } catch {
            failure = "UI observation failed";
          }
          if (failure !== null) finish(failure);
        }
        function finish(failure: string | null) {
          if (finished) return;
          finished = true;
          observer?.disconnect();
          clearInterval(poll);
          clearTimeout(deadline);
          removeEventListener("pagehide", departed);
          result.resolve(failure);
        }
        function departed() {
          finish("navigation changed");
        }
        // Observe late React commits; polling also catches storage, URL and input properties.
        try {
          observer = new MutationObserver(check);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          addEventListener("pagehide", departed);
          poll = window.setInterval(check, 25);
          deadline = window.setTimeout(() => {
            check();
            finish(null);
          }, 750);
          check();
        } catch {
          finish("UI observation failed");
        }
        return {
          result: result.promise,
          cancel: () => finish("UI observation failed"),
        };
      },
      { successor, copy: en },
    );
    let abandoned = false;
    // A late handle after acquisition timeout must also release its browser resources.
    const owned = acquisition.then(async (handle) => {
      if (abandoned) {
        try {
          await authBounded(
            handle.evaluate((state) => state.cancel()),
            1_000,
          );
        } finally {
          await authBounded(handle.dispose(), 1_000);
        }
      }
      return handle;
    });
    try {
      const handle = await authBounded(owned, 2_000);
      try {
        const observed = await authBounded(
          handle.evaluate((state) => state.result),
          2_000,
        );
        failure ??= observed;
      } finally {
        observing = false;
        try {
          if (!page.isClosed())
            await authBounded(
              handle.evaluate((state) => state.cancel()),
              1_000,
            );
        } finally {
          await authBounded(handle.dispose(), 1_000);
        }
      }
    } finally {
      abandoned = true;
    }
  } catch {
    failure ??= "UI observation failed";
  } finally {
    observing = false;
    page.off("framenavigated", navigated);
    page.off("close", closed);
  }
  if (failure !== null) throw new Error(`Successor OTP UI failed: ${failure}.`);
}
