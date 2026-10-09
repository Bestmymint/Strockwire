import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { en } from "../../../apps/web/src/i18n/en";
import { th } from "../../../apps/web/src/i18n/th";

const selector = "11111111-1111-4111-8111-111111111111";
const storageKey = "stockwise_verification_continuation";
const syntheticToken = "a".repeat(43);

for (const width of [320, 390, 768, 1280])
  for (const language of ["en", "th"] as const)
    for (const theme of ["light", "dark"]) {
      test(`safe auth surfaces ${width}px ${language} ${theme}`, async ({
        page,
      }) => {
        await page.route("**/api/**", (route) =>
          route.fulfill({
            status: 401,
            json: { error: { code: "AUTHENTICATION_REQUIRED" } },
          }),
        );
        await page.addInitScript(
          ({ language, theme, storageKey, selector }) => {
            localStorage.setItem("stockwise.language", language);
            localStorage.setItem("stockwise.theme", theme);
            if (!sessionStorage.getItem(storageKey))
              sessionStorage.setItem(
                storageKey,
                JSON.stringify({
                  version: 1,
                  canonicalEmail: "synthetic@example.invalid",
                  challengeId: selector,
                  savedAt: Date.now(),
                }),
              );
          },
          { language, theme, storageKey, selector },
        );
        await page.setViewportSize({ width, height: 900 });
        const copy = language === "en" ? en : th;
        let errors = 0;
        let warnings = 0;
        page.on("pageerror", () => {
          errors += 1;
        });
        page.on("console", (message) => {
          if (message.type() === "warning") warnings += 1;
        });
        for (const path of [
          "/register",
          "/login",
          "/verification-resend",
          "/verify-email",
        ]) {
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await expect(page.locator("html")).toHaveClass(new RegExp(theme));
          await expect(page.locator("form")).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          if (path === "/register" || path === "/login") {
            await expect(page.getByLabel(copy.authEmail)).toHaveAttribute(
              "type",
              "email",
            );
            await expect(
              page.getByLabel(copy.authPassword, { exact: true }),
            ).toHaveAttribute("type", "password");
          }
          if (path === "/verify-email") {
            const otp = page.getByLabel(copy.authOtpLabel);
            await otp.focus();
            await otp.pressSequentially("012345");
            await expect(otp).toHaveValue("012345");
            await otp.press("Tab");
            await expect(
              page.getByRole("button", { name: copy.authVerify, exact: true }),
            ).toBeFocused();
          }
          expect(
            (await new AxeBuilder({ page }).analyze()).violations.map(
              (v) => v.id,
            ),
          ).toEqual([]);
        }
        await page.route("**/api/v1/auth/verify-email-code", (route) =>
          route.fulfill({
            status: 401,
            json: { error: { code: "VERIFICATION_PASSWORD_PROOF_REQUIRED" } },
          }),
        );
        await page
          .getByRole("button", { name: copy.authVerify, exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: copy.authProofSubmit, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel(copy.authProofPassword, { exact: true }),
        ).toHaveAttribute("type", "password");
        expect(
          (await new AxeBuilder({ page }).analyze()).violations.map(
            (v) => v.id,
          ),
        ).toEqual([]);
        await page.goto(`/verify-email?token=${syntheticToken}`);
        await expect(
          page.getByRole("button", { name: copy.authVerify, exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            (token) =>
              !location.href.includes(token) &&
              !JSON.stringify(history.state).includes(token),
            syntheticToken,
          ),
        ).toBe(true);
        await page.reload();
        await expect(
          page.getByRole("link", { name: copy.authBackToLogin, exact: true }),
        ).toBeVisible();
        expect(errors).toBe(0);
        expect(warnings).toBe(0);
      });
    }
