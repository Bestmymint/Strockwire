// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiError,
  completeFirstOrganizationOnboarding,
  forgotPassword,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "@/api-client";

import { passwordValidationMessage } from "./auth-form-support";
import { EmailRequestForm } from "./email-request-form";
import { LoginForm } from "./login-form";
import { LogoutButton } from "./logout-button";
import { OnboardingForm } from "./onboarding-form";
import { RegistrationForm } from "./registration-form";
import { ResetPasswordForm } from "./reset-password-form";
import { VerificationForm } from "./verification-form";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api-client")>();
  return {
    ...actual,
    forgotPassword: vi.fn(),
    completeFirstOrganizationOnboarding: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    resendVerification: vi.fn(),
    resetPassword: vi.fn(),
    verifyEmail: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  vi.mocked(forgotPassword).mockReset();
  vi.mocked(completeFirstOrganizationOnboarding).mockReset();
  vi.mocked(login).mockReset();
  vi.mocked(logout).mockReset();
  vi.mocked(register).mockReset();
  vi.mocked(resendVerification).mockReset();
  vi.mocked(resetPassword).mockReset();
  vi.mocked(verifyEmail).mockReset();
  window.history.replaceState(null, "", "/");
});

function fillCredentials(password = "  password with Unicode Ω  ") {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}

function renderWithQueryClient(ui: ReactNode, queryClient = new QueryClient()) {
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

describe("registration form", () => {
  it("renders only email and password, preserves their values, and shows a generic accepted state", async () => {
    vi.mocked(register).mockResolvedValue({
      data: { nextStep: "verify_email", status: "accepted" },
    });
    render(<RegistrationForm />);
    fillCredentials();

    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        email: "person@example.com",
        password: "  password with Unicode Ω  ",
      }),
    );
    expect(
      await screen.findByText(
        "Check your email for the next step. You can request a verification email when you are ready.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/already exists|existing account/i)).toBeNull();
  });

  it("shows client validation and rate limit feedback without submitting invalid input", async () => {
    render(<RegistrationForm />);
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Enter a valid email address.",
    );
    expect(register).not.toHaveBeenCalled();

    cleanup();
    vi.mocked(register).mockRejectedValue(new AuthApiError("rate_limited", 60));
    render(<RegistrationForm />);
    fillCredentials();
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please wait 60 seconds before trying again.",
    );
  });
});

describe("login form", () => {
  function renderLoginForm(queryClient = new QueryClient()) {
    return renderWithQueryClient(<LoginForm />, queryClient);
  }

  it("submits exact credentials, prevents a duplicate pending submission, and enters the access-context flow", async () => {
    let resolveLogin: (() => void) | undefined;
    vi.mocked(login).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = () =>
            resolve({
              data: {
                user: {
                  displayName: null,
                  email: "person@example.com",
                  id: "user-id",
                },
              },
            });
        }),
    );
    const queryClient = renderLoginForm();
    queryClient.setQueryData(["access-context"], {
      organizations: [],
      user: { displayName: null, email: "previous@example.com", id: "old" },
    });
    fillCredentials();

    const form = screen
      .getByRole("button", { name: "Sign in" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(login).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: "Signing in…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    resolveLogin?.();
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/app"));
    expect(queryClient.getQueryData(["access-context"])).toBeUndefined();
  });

  it("shows generic invalid credentials and rate-limit states", async () => {
    vi.mocked(login).mockRejectedValue(new AuthApiError("invalid_credentials"));
    renderLoginForm();
    fillCredentials();
    fireEvent.submit(
      screen.getByRole("button", { name: "Sign in" }).closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The email or password is incorrect.",
    );

    cleanup();
    vi.mocked(login).mockRejectedValue(new AuthApiError("rate_limited", 15));
    renderLoginForm();
    fillCredentials();
    fireEvent.submit(
      screen.getByRole("button", { name: "Sign in" }).closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please wait 15 seconds before trying again.",
    );
  });
});

describe("first organization onboarding form", () => {
  function renderOnboardingForm(queryClient = new QueryClient()) {
    return renderWithQueryClient(<OnboardingForm />, queryClient);
  }

  function fillOnboarding() {
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  Owner  Name  " },
    });
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "  Example  Store  " },
    });
    fireEvent.change(screen.getByLabelText("First branch name"), {
      target: { value: "  Main  Branch  " },
    });
  }

  it("renders exactly the accepted fields, submits no actor or branch code, and prevents duplicate submission", async () => {
    let resolveOnboarding: (() => void) | undefined;
    vi.mocked(completeFirstOrganizationOnboarding).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOnboarding = () =>
            resolve({
              data: {
                branch: {
                  address: null,
                  code: "MAIN",
                  id: "branch-id",
                  name: "Main  Branch",
                  phone: null,
                },
                nextStep: "app",
                organization: {
                  id: "organization-id",
                  name: "Example  Store",
                },
                role: "OWNER",
                user: {
                  displayName: "Owner  Name",
                  id: "user-id",
                  phone: null,
                },
              },
            });
        }),
    );
    const queryClient = renderOnboardingForm();
    queryClient.setQueryData(["access-context"], {
      firstOrganizationOnboarding: { eligible: true },
      organizations: [],
      user: { displayName: null, email: "person@example.com", id: "user-id" },
    });
    fillOnboarding();

    expect(screen.queryByLabelText(/branch code/i)).toBeNull();
    expect(screen.queryByLabelText(/user id|organization id|role/i)).toBeNull();
    const form = screen
      .getByRole("button", { name: "Create organization" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(completeFirstOrganizationOnboarding).toHaveBeenCalledTimes(1);
    expect(completeFirstOrganizationOnboarding).toHaveBeenCalledWith({
      branchAddress: "",
      branchName: "  Main  Branch  ",
      branchPhone: "",
      displayName: "  Owner  Name  ",
      organizationName: "  Example  Store  ",
      phone: "",
    });
    expect(
      screen
        .getByRole("button", { name: "Creating organization…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    resolveOnboarding?.();
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/app"));
    expect(queryClient.getQueryData(["access-context"])).toBeUndefined();
  });

  it("blocks whitespace-only required values and presents both safe conflict states", async () => {
    renderOnboardingForm();
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create organization" })
        .closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Enter a display name, organization name, and branch name.",
    );
    expect(completeFirstOrganizationOnboarding).not.toHaveBeenCalled();

    cleanup();
    vi.mocked(completeFirstOrganizationOnboarding).mockRejectedValue(
      new AuthApiError("already_onboarded"),
    );
    renderOnboardingForm();
    fillOnboarding();
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create organization" })
        .closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already completed",
    );

    cleanup();
    vi.mocked(completeFirstOrganizationOnboarding).mockRejectedValue(
      new AuthApiError("already_has_organization_access"),
    );
    renderOnboardingForm();
    fillOnboarding();
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create organization" })
        .closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already has organization access",
    );
  });
});

describe("verification and resend forms", () => {
  it("submits the query token, removes it from the address after completion, and presents a safe result", async () => {
    window.history.replaceState(null, "", "/verify-email?token=opaque-token");
    vi.mocked(verifyEmail).mockResolvedValue({ data: { status: "verified" } });
    render(<VerificationForm />);
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() =>
      expect(verifyEmail).toHaveBeenCalledWith({ token: "opaque-token" }),
    );
    expect(window.location.search).toBe("");
    expect(
      await screen.findByText(
        "Your email has been verified. You can now sign in.",
      ),
    ).toBeTruthy();
  });

  it("handles invalid links and non-disclosing resend completion/rate limits", async () => {
    window.history.replaceState(null, "", "/verify-email?token=expired");
    vi.mocked(verifyEmail).mockRejectedValue(new AuthApiError("invalid_token"));
    render(<VerificationForm />);
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This verification link is invalid or expired.",
    );
    expect(window.location.search).toBe("");

    cleanup();
    vi.mocked(resendVerification).mockResolvedValue({
      data: { status: "accepted" },
    });
    render(<EmailRequestForm kind="verification" />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Request verification email" })
        .closest("form")!,
    );
    expect(
      await screen.findByText(/If that email can receive a verification email/),
    ).toBeTruthy();

    cleanup();
    vi.mocked(resendVerification).mockRejectedValue(
      new AuthApiError("rate_limited", 45),
    );
    render(<EmailRequestForm kind="verification" />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Request verification email" })
        .closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please wait 45 seconds before trying again.",
    );
  });
});

describe("password recovery and logout", () => {
  it("keeps forgot-password completion non-disclosing and handles rate limits", async () => {
    vi.mocked(forgotPassword).mockResolvedValue({
      data: { status: "accepted" },
    });
    render(<EmailRequestForm kind="password_reset" />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Request password reset" })
        .closest("form")!,
    );
    expect(
      await screen.findByText(/If that email can receive a password reset/),
    ).toBeTruthy();

    cleanup();
    vi.mocked(forgotPassword).mockRejectedValue(
      new AuthApiError("rate_limited", 20),
    );
    render(<EmailRequestForm kind="password_reset" />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Request password reset" })
        .closest("form")!,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please wait 20 seconds before trying again.",
    );
  });

  it("enforces the exact password length UX and submits an unchanged Unicode password with the query token", async () => {
    expect(passwordValidationMessage("a".repeat(14))).not.toBeNull();
    expect(passwordValidationMessage("a".repeat(15))).toBeNull();
    expect(passwordValidationMessage("a".repeat(128))).toBeNull();
    expect(passwordValidationMessage("a".repeat(129))).not.toBeNull();
    expect(passwordValidationMessage("😀".repeat(15))).toBeNull();

    window.history.replaceState(
      null,
      "",
      "/reset-password?token=opaque-reset-token",
    );
    vi.mocked(resetPassword).mockResolvedValue({
      data: { status: "password_reset" },
    });
    render(<ResetPasswordForm />);
    const password = "  รหัสผ่านสำหรับทดสอบ 😀  ";
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: password },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Reset password" }).closest("form")!,
    );

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        newPassword: password,
        token: "opaque-reset-token",
      }),
    );
    expect(window.location.search).toBe("");
    expect(
      await screen.findByText(
        "Your password has been reset. Sign in with your new password.",
      ),
    ).toBeTruthy();
  });

  it("calls the current-session logout endpoint and leaves cookie handling to the API", async () => {
    vi.mocked(logout).mockResolvedValue(undefined);
    const queryClient = renderWithQueryClient(<LogoutButton />);
    queryClient.setQueryData(["access-context"], {
      organizations: [],
      user: { displayName: null, email: "person@example.com", id: "user-id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(routerPush).toHaveBeenCalledWith("/login");
    expect(queryClient.getQueryData(["access-context"])).toBeUndefined();
  });
});
