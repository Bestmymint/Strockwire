"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { AuthApiError, resetPassword } from "@/api-client";

import {
  authErrorMessage,
  passwordValidationMessage,
} from "./auth-form-support";

function tokenFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function removeTokenFromAddress(): void {
  window.history.replaceState(null, "", "/reset-password");
}

export function ResetPasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReset, setIsReset] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const token = tokenFromAddress();
    if (token === null || token.length === 0) {
      setError("This password reset link is invalid or expired.");
      return;
    }

    const passwordError = passwordValidationMessage(newPassword);
    if (passwordError !== null) {
      setError(passwordError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await resetPassword({ newPassword, token });
      removeTokenFromAddress();
      setIsReset(true);
    } catch (requestError: unknown) {
      if (
        requestError instanceof AuthApiError &&
        requestError.kind === "invalid_token"
      ) {
        removeTokenFromAddress();
      }
      setError(
        authErrorMessage(requestError, {
          invalid_token: "This password reset link is invalid or expired.",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isReset) {
    return (
      <div aria-live="polite">
        <p className="text-sm leading-6 text-muted-foreground">
          Your password has been reset. Sign in with your new password.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/login"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <label className="form-field" htmlFor="reset-password">
          New password
        </label>
        <input
          autoComplete="new-password"
          className="form-control mt-1"
          disabled={isSubmitting}
          id="reset-password"
          name="new-password"
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Use 15–128 Unicode code points. Spaces and Unicode characters are
          allowed.
        </p>
      </div>
      {error === null ? null : (
        <p
          aria-live="assertive"
          className="text-sm text-red-700 form-message"
          role="alert"
        >
          {error}
        </p>
      )}
      <button
        className="min-h-11 w-full rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 form-action"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Resetting password…" : "Reset password"}
      </button>
    </form>
  );
}
