"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { register } from "@/api-client";

import {
  authErrorMessage,
  hasEmailShape,
  passwordValidationMessage,
} from "./auth-form-support";

export function RegistrationForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (!hasEmailShape(email)) {
      setError("Enter a valid email address.");
      return;
    }

    const passwordError = passwordValidationMessage(password);
    if (passwordError !== null) {
      setError(passwordError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await register({ email, password });
      setIsAccepted(true);
    } catch (requestError: unknown) {
      setError(authErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isAccepted) {
    return (
      <div aria-live="polite">
        <p className="text-sm leading-6 text-muted-foreground">
          Check your email for the next step. You can request a verification
          email when you are ready.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/verification-resend"
        >
          Request verification email
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <label className="text-sm font-medium" htmlFor="registration-email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="mt-2 min-h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isSubmitting}
          id="registration-email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="registration-password">
          Password
        </label>
        <input
          autoComplete="new-password"
          className="mt-2 min-h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isSubmitting}
          id="registration-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Use 15–128 Unicode code points. Spaces and Unicode characters are
          allowed.
        </p>
      </div>
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
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="font-medium text-foreground underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
