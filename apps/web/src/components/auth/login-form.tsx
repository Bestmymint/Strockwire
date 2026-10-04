"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { login } from "@/api-client";

import {
  authErrorMessage,
  hasEmailShape,
  passwordValidationMessage,
} from "./auth-form-support";

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await login({ email, password });
      queryClient.removeQueries({ queryKey: ["access-context"] });
      router.push("/app");
    } catch (requestError: unknown) {
      setError(
        authErrorMessage(requestError, {
          invalid_credentials: "The email or password is incorrect.",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <label className="form-field" htmlFor="login-email">
          Email address
        </label>
        <input
          autoComplete="email"
          className="form-control mt-1"
          disabled={isSubmitting}
          id="login-email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label className="form-field" htmlFor="login-password">
            Password
          </label>
          <Link className="text-sm underline" href="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <input
          autoComplete="current-password"
          className="form-control mt-1"
          disabled={isSubmitting}
          id="login-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
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
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        Need an account?{" "}
        <Link
          className="font-medium text-foreground underline"
          href="/register"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
