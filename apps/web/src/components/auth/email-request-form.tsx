"use client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { forgotPassword, resendVerification } from "@/api-client";

import { authErrorMessage, hasEmailShape } from "./auth-form-support";

type RequestKind = "password_reset" | "verification";

const copy: Record<
  RequestKind,
  { button: string; success: string; otherLink: string; otherText: string }
> = {
  password_reset: {
    button: "Request password reset",
    otherLink: "/login",
    otherText: "Back to sign in",
    success:
      "If that email can receive a password reset, check its inbox for the next step.",
  },
  verification: {
    button: "Request verification email",
    otherLink: "/login",
    otherText: "Back to sign in",
    success:
      "If that email can receive a verification email, check its inbox for the next step.",
  },
};

interface EmailRequestFormProps {
  kind: RequestKind;
}

export function EmailRequestForm({ kind }: EmailRequestFormProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);
  const content = copy[kind];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (!hasEmailShape(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (kind === "verification") {
        await resendVerification({ email });
      } else {
        await forgotPassword({ email });
      }
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
          {content.success}
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href={content.otherLink}
        >
          {content.otherText}
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <Label className="form-field" htmlFor={`${kind}-email`}>
          Email address
        </Label>
        <Input
          autoComplete="email"
          className="mt-1"
          disabled={isSubmitting}
          id={`${kind}-email`}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      {error === null ? null : (
        <p
          aria-live="assertive"
          className="text-sm text-destructive form-message"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Sending request…" : content.button}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link
          className="font-medium text-foreground underline"
          href={content.otherLink}
        >
          {content.otherText}
        </Link>
      </p>
    </form>
  );
}
