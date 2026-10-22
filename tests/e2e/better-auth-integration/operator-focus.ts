import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  hasCompletedNativeCycle,
  type NativeFocusState,
} from "./native-focus-sequence";

type FocusState = NativeFocusState;
type FocusWindow = Window & { __d4n3Operator?: FocusState };
const evidence = "test-results/better-auth-integration/operator";

// Deliberately not a network/DOM Playwright trace: auth headers and credentials
// must not be persisted. This trace contains only native event metadata.
export async function armOperatorFocus(page: Page, phase: "otp" | "login") {
  await page.evaluate((phase) => {
    document.title = `StockWise D4-N3 OPERATOR ${phase.toUpperCase()}`;
    const state: FocusState = {
      clicked: false,
      epochStartedAt: null,
      events: [],
    };
    (window as FocusWindow).__d4n3Operator = state;
    function record(kind: string, event: Event) {
      if (state.events.length < 64)
        state.events.push({
          kind,
          at: event.timeStamp,
          trusted: event.isTrusted,
          focused: document.hasFocus(),
        });
    }
    window.addEventListener("pointerdown", (event) => {
      if (event.isTrusted && event.target instanceof HTMLInputElement) {
        state.clicked = true;
        record("input-click", event);
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Alt" && event.altKey) {
        record("alt-key", event);
      }
    });
    window.addEventListener("blur", (event) => {
      record("blur", event);
    });
    window.addEventListener("focus", (event) => {
      record("focus", event);
    });
  }, phase);
  await mkdir(evidence, { recursive: true });
}

export async function waitForOperatorClick(page: Page) {
  console.log("D4N3_OPERATOR:OTP_CLICK");
  try {
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as FocusWindow).__d4n3Operator?.clicked === true &&
              document.hasFocus(),
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
  } finally {
    const state = await page.evaluate(
      () => (window as FocusWindow).__d4n3Operator,
    );
    await writeFile(
      join(evidence, "otp-acquisition-events.json"),
      JSON.stringify({ state }, null, 2),
    );
    await page.screenshot({
      path: join(evidence, "otp-acquisition.png"),
      mask: [page.locator("input, textarea")],
    });
  }
}

export async function verifyOperatorAltTab(page: Page, phase: "otp" | "login") {
  const masked = page.locator("input, textarea");
  await page.screenshot({
    path: join(evidence, `${phase}-before.png`),
    mask: [masked],
  });
  // Called only after the draft is filled. Acquisition/pre-draft events cannot
  // satisfy this fresh observation epoch, for either OTP or login.
  await page.evaluate((phase) => {
    const state = (window as FocusWindow).__d4n3Operator;
    if (state === undefined) throw new Error("operator-observer-missing");
    state.events = [];
    state.epochStartedAt = performance.now();
    document.title = `StockWise D4-N3 POST-DRAFT ${phase.toUpperCase()}`;
  }, phase);
  console.log(`D4N3_OPERATOR:${phase === "otp" ? "OTP" : "LOGIN"}_ALT_TAB`);
  try {
    await expect
      .poll(
        async () => {
          const observation = await page.evaluate(() => ({
            state: (window as FocusWindow).__d4n3Operator,
            focused: document.hasFocus(),
          }));
          return hasCompletedNativeCycle(
            observation.state,
            observation.focused,
          );
        },
        { timeout: 90_000 },
      )
      .toBe(true);
  } finally {
    const state = await page.evaluate(
      () => (window as FocusWindow).__d4n3Operator,
    );
    await writeFile(
      join(evidence, `${phase}-native-events.json`),
      JSON.stringify({ phase, ...state }, null, 2),
    );
    await page.screenshot({
      path: join(evidence, `${phase}-after.png`),
      mask: [masked],
    });
  }
  console.log(`D4N3_OPERATOR:${phase === "otp" ? "OTP" : "LOGIN"}_FOCUS_PASS`);
}
export async function recordOperatorHistory(restored: boolean) {
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "history-proof.json"),
    JSON.stringify(
      {
        refresh: true,
        persistedPageShow: restored,
        forward: true,
        secondBackOtpVisible: true,
      },
      null,
      2,
    ),
  );
}
