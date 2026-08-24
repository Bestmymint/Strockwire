"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { AuthApiError, verifyEmail } from "@/api-client";

import { authErrorMessage } from "./auth-form-support";

function tokenFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function removeTokenFromAddress(): void {
  window.history.replaceState(null, "", "/verify-email");
}

export function VerificationForm() {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const token = tokenFromAddress();
    if (token === null || token.length === 0) {
      setError("This verification link is invalid or expired.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await verifyEmail({ token });
      removeTokenFromAddress();
      setIsVerified(true);
    } catch (requestError: unknown) {
      if (
        requestError instanceof AuthApiError &&
        requestError.kind === "invalid_token"
      ) {
        removeTokenFromAddress();
      }
      setError(
        authErrorMessage(requestError, {
          invalid_token: "This verification link is invalid or expired.",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isVerified) {
    return (
      <div aria-live="polite">
        <p className="text-sm leading-6 text-muted-foreground">
          Your email has been verified. You can now sign in.
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
    <form className="space-y-5" onSubmit={handleSubmit}>
      <p className="text-sm leading-6 text-muted-foreground">
        Confirm your email address to finish verification.
      </p>
      {error === null ? null : (
        <p aria-live="assertive" className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="min-h-11 w-full rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Verifying email…" : "Verify email"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        Need another link?{" "}
        <Link
          className="font-medium text-foreground underline"
          href="/verification-resend"
        >
          Request a verification email
        </Link>
      </p>
    </form>
  );
}
