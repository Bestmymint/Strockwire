"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
        <Button
          className="mt-5"
          nativeButton={false}
          role="link"
          render={<Link href="/verification-resend" />}
        >
          Request verification email
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <Label className="form-field" htmlFor="registration-email">
          Email address
        </Label>
        <Input
          autoComplete="email"
          className="mt-1"
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
        <Label className="form-field" htmlFor="registration-password">
          Password
        </Label>
        <Input
          autoComplete="new-password"
          className="mt-1"
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
        <Alert variant="destructive" aria-live="assertive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="font-medium text-foreground underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
