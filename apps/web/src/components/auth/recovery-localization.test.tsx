// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, forgotPassword, resetPassword } from "@/api-client";
import type * as AuthApi from "@/api-client";
import ForgotPasswordPage from "@/app/forgot-password/page";
import ResetPasswordPage from "@/app/reset-password/page";
import { en } from "@/i18n/en";
import { th } from "@/i18n/th";
import { LanguageProvider, useLanguage } from "@/providers/language-provider";
import type { CredentialLinkWindow } from "@/credential-link-entry";

vi.mock("@/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthApi>()),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

const syntheticToken = "A".repeat(43);
const password = "  synthetic Unicode password 😀  ";
function LanguageControls() {
  const { setLanguage } = useLanguage();
  return (
    <>
      <button onClick={() => setLanguage("en")}>EN</button>
      <button onClick={() => setLanguage("th")}>TH</button>
    </>
  );
}
function renderRecovery(
  flow: "forgot" | "reset",
  language: "en" | "th",
  withToken = true,
) {
  localStorage.setItem("stockwise.language", language);
  if (withToken)
    (window as CredentialLinkWindow).__stockwiseTakeCredentialLink = vi.fn(
      () => ({ route: "/reset-password" as const, token: syntheticToken }),
    );
  return render(
    <LanguageProvider>
      <LanguageControls />
      {flow === "forgot" ? <ForgotPasswordPage /> : <ResetPasswordPage />}
    </LanguageProvider>,
  );
}
function submit() {
  fireEvent.submit(document.querySelector("form")!);
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function switchLanguage(language: "en" | "th") {
  fireEvent.click(screen.getByRole("button", { name: language.toUpperCase() }));
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  delete (window as CredentialLinkWindow).__stockwiseTakeCredentialLink;
});

describe.each(["en", "th"] as const)("%s password recovery", (language) => {
  const copy = language === "th" ? th : en;
  const otherLanguage = language === "th" ? "en" : "th";
  const other = language === "th" ? en : th;

  it("localizes forgot-password validation and updates existing feedback without losing the email draft", () => {
    renderRecovery("forgot", language);
    expect(
      screen.getByRole("heading", { name: copy.authForgotTitle }),
    ).toBeTruthy();
    expect(screen.getByText(copy.authForgotDescription)).toBeTruthy();
    fill(copy.authEmail, "invalid");
    submit();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(copy.authInvalidEmail);
    expect(document.activeElement).toBe(alert);
    expect(
      screen.getByLabelText(copy.authEmail).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByLabelText(copy.authEmail).getAttribute("aria-describedby"),
    ).toBe(alert.id);
    switchLanguage(otherLanguage);
    expect(screen.getByRole("alert").textContent).toBe(other.authInvalidEmail);
    expect(
      (screen.getByLabelText(other.authEmail) as HTMLInputElement).value,
    ).toBe("invalid");
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  it("updates forgot-password pending and privacy-neutral success states during language changes", async () => {
    const pending = Promise.withResolvers<{ data: { status: "accepted" } }>();
    vi.mocked(forgotPassword).mockReturnValue(pending.promise);
    renderRecovery("forgot", language);
    fill(copy.authEmail, "synthetic@example.test");
    submit();
    expect(
      screen
        .getByRole("button", { name: copy.authResendSending })
        .hasAttribute("disabled"),
    ).toBe(true);
    switchLanguage(otherLanguage);
    expect(
      screen.getByRole("button", { name: other.authResendSending }),
    ).toBeTruthy();
    await act(async () => pending.resolve({ data: { status: "accepted" } }));
    expect(screen.getByRole("status").textContent).toBe(
      other.authResetAccepted,
    );
    expect(document.activeElement).toBe(screen.getByRole("status"));
    switchLanguage(language);
    expect(screen.getByRole("status").textContent).toBe(copy.authResetAccepted);
    expect(
      screen
        .getByRole("link", { name: copy.authBackToLogin })
        .getAttribute("href"),
    ).toBe("/login");
  });

  it.each(["unavailable", "validation", "rate_limited"] as const)(
    "localizes forgot-password %s and allows retry",
    async (kind) => {
      vi.mocked(forgotPassword).mockRejectedValueOnce(
        new AuthApiError(kind, kind === "rate_limited" ? 20 : null),
      );
      renderRecovery("forgot", language);
      fill(copy.authEmail, "synthetic@example.test");
      submit();
      const expected =
        kind === "rate_limited"
          ? copy.authRateLimited
              .replace("{seconds}", "20")
              .replace("{plural}", "s")
          : kind === "validation"
            ? copy.authCheckInformation
            : copy.authRequestError;
      expect((await screen.findByRole("alert")).textContent).toBe(expected);
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("alert")),
      );
      switchLanguage(otherLanguage);
      expect(screen.getByRole("alert").textContent).toBe(
        kind === "rate_limited"
          ? other.authRateLimited
              .replace("{seconds}", "20")
              .replace("{plural}", "s")
          : kind === "validation"
            ? other.authCheckInformation
            : other.authRequestError,
      );
      vi.mocked(forgotPassword).mockResolvedValueOnce({
        data: { status: "accepted" },
      });
      submit();
      expect((await screen.findByRole("status")).textContent).toBe(
        other.authResetAccepted,
      );
    },
  );

  it("localizes password requirements and validation while preserving the draft and one-use token across switching", async () => {
    renderRecovery("reset", language);
    expect(
      screen.getByRole("heading", { name: copy.authResetTitle }),
    ).toBeTruthy();
    expect(screen.getByText(copy.authResetDescription)).toBeTruthy();
    const input = screen.getByLabelText(copy.authNewPassword);
    expect(
      document.getElementById(input.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(copy.authPasswordLength);
    fill(copy.authNewPassword, "short");
    submit();
    expect(screen.getByRole("alert").textContent).toBe(copy.authPasswordLength);
    expect(document.activeElement).toBe(screen.getByRole("alert"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    switchLanguage(otherLanguage);
    expect(screen.getByRole("alert").textContent).toBe(
      other.authPasswordLength,
    );
    expect(
      (screen.getByLabelText(other.authNewPassword) as HTMLInputElement).value,
    ).toBe("short");
    expect(resetPassword).not.toHaveBeenCalled();
    vi.mocked(resetPassword).mockResolvedValue({
      data: { status: "password_reset" },
    });
    fill(other.authNewPassword, password);
    submit();
    await screen.findByRole("status");
    expect(resetPassword).toHaveBeenCalledWith({
      newPassword: password,
      token: syntheticToken,
    });
    expect(
      (window as CredentialLinkWindow).__stockwiseTakeCredentialLink,
    ).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(localStorage)).not.toContain(syntheticToken);
    expect(JSON.stringify(sessionStorage)).not.toContain(password);
  });

  it("updates reset pending and completion feedback and offers explicit sign-in", async () => {
    const pending = Promise.withResolvers<{
      data: { status: "password_reset" };
    }>();
    vi.mocked(resetPassword).mockReturnValue(pending.promise);
    renderRecovery("reset", language);
    fill(copy.authNewPassword, password);
    submit();
    expect(
      screen
        .getByRole("button", { name: copy.authResettingPassword })
        .hasAttribute("disabled"),
    ).toBe(true);
    switchLanguage(otherLanguage);
    expect(
      screen.getByRole("button", { name: other.authResettingPassword }),
    ).toBeTruthy();
    await act(async () =>
      pending.resolve({ data: { status: "password_reset" } }),
    );
    expect(screen.getByRole("status").textContent).toBe(
      other.authResetComplete,
    );
    expect(document.activeElement).toBe(screen.getByRole("status"));
    switchLanguage(language);
    expect(screen.getByRole("status").textContent).toBe(copy.authResetComplete);
    expect(
      screen.getByRole("link", { name: copy.authSignIn }).getAttribute("href"),
    ).toBe("/login");
    expect(screen.queryByLabelText(copy.authNewPassword)).toBeNull();
  });

  it("localizes missing reset links and never submits without a credential", () => {
    renderRecovery("reset", language, false);
    expect(screen.getByRole("alert").textContent).toBe(
      copy.authInvalidResetLink,
    );
    expect(document.activeElement).toBe(screen.getByRole("alert"));
    switchLanguage(otherLanguage);
    expect(screen.getByRole("alert").textContent).toBe(
      other.authInvalidResetLink,
    );
    fill(other.authNewPassword, password);
    submit();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("localizes server-rejected expired links and prevents reuse", async () => {
    vi.mocked(resetPassword).mockRejectedValue(
      new AuthApiError("invalid_token"),
    );
    renderRecovery("reset", language);
    fill(copy.authNewPassword, password);
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe(
      copy.authInvalidResetLink,
    );
    switchLanguage(otherLanguage);
    expect(screen.getByRole("alert").textContent).toBe(
      other.authInvalidResetLink,
    );
    submit();
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });

  it("localizes safe reset errors, retains the credential for retry, and suppresses internal text", async () => {
    vi.mocked(resetPassword).mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    renderRecovery("reset", language);
    fill(copy.authNewPassword, password);
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe(
      copy.authRequestError,
    );
    expect(document.activeElement).toBe(screen.getByRole("alert"));
    switchLanguage(otherLanguage);
    expect(screen.getByRole("alert").textContent).toBe(other.authRequestError);
    expect(screen.queryByText("private provider detail")).toBeNull();
    vi.mocked(resetPassword).mockResolvedValueOnce({
      data: { status: "password_reset" },
    });
    submit();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        other.authResetComplete,
      ),
    );
    expect(resetPassword).toHaveBeenLastCalledWith({
      newPassword: password,
      token: syntheticToken,
    });
  });

  it("shows recovery immediately when a reset document returns from BFCache", () => {
    renderRecovery("reset", language);
    fill(copy.authNewPassword, password);
    fireEvent(window, new Event("pagehide"));
    fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
    expect(screen.getByRole("alert").textContent).toBe(
      copy.authInvalidResetLink,
    );
    expect(
      screen
        .getByRole("link", { name: copy.authForgotPassword })
        .getAttribute("href"),
    ).toBe("/forgot-password");
    expect(
      (screen.getByLabelText(copy.authNewPassword) as HTMLInputElement).value,
    ).toBe("");
    submit();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("discards a reset credential and password on pagehide despite a late success", async () => {
    const pending = Promise.withResolvers<{
      data: { status: "password_reset" };
    }>();
    vi.mocked(resetPassword).mockReturnValue(pending.promise);
    renderRecovery("reset", language);
    fill(copy.authNewPassword, password);
    submit();
    fireEvent(window, new Event("pagehide"));
    await act(async () =>
      pending.resolve({ data: { status: "password_reset" } }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      (screen.getByLabelText(copy.authNewPassword) as HTMLInputElement).value,
    ).toBe("");
    switchLanguage(otherLanguage);
    fill(other.authNewPassword, password);
    submit();
    expect(screen.getByRole("alert").textContent).toBe(
      other.authInvalidResetLink,
    );
    expect(resetPassword).toHaveBeenCalledTimes(1);
    for (const storage of [localStorage, sessionStorage]) {
      expect(JSON.stringify(storage)).not.toContain(syntheticToken);
      expect(JSON.stringify(storage)).not.toContain(password);
    }
  });
});
