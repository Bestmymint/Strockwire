"use client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { forgotPassword } from "@/api-client";
import { useLanguage } from "@/providers/language-provider";

import { verificationErrorMessage } from "./auth-copy";
import { hasEmailShape } from "./auth-form-support";

interface EmailRequestFormProps {
  kind: "password_reset";
}

export function EmailRequestForm({ kind }: EmailRequestFormProps) {
  const { t } = useLanguage();
  const message = useRef<HTMLParagraphElement>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);
  useEffect(() => {
    if (error !== null || invalidEmail || isAccepted) message.current?.focus();
  }, [error, invalidEmail, isAccepted]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (!hasEmailShape(email)) {
      setInvalidEmail(true);
      return;
    }

    setError(null);
    setInvalidEmail(false);
    setIsSubmitting(true);

    try {
      await forgotPassword({ email });
      setIsAccepted(true);
    } catch (requestError: unknown) {
      setError(requestError);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isAccepted) {
    return (
      <div>
        <p
          className="text-sm leading-6 text-muted-foreground"
          ref={message}
          role="status"
          tabIndex={-1}
        >
          {t("authResetAccepted")}
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/login"
          replace
        >
          {t("authBackToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <Label className="form-field" htmlFor={`${kind}-email`}>
          {t("authEmail")}
        </Label>
        <Input
          aria-describedby={
            error !== null || invalidEmail ? `${kind}-error` : undefined
          }
          aria-invalid={invalidEmail}
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
      {error === null && !invalidEmail ? null : (
        <p
          aria-live="assertive"
          className="text-sm text-destructive form-message"
          id={`${kind}-error`}
          ref={message}
          tabIndex={-1}
          role="alert"
        >
          {invalidEmail
            ? t("authInvalidEmail")
            : verificationErrorMessage(error, t)}
        </p>
      )}
      <Button
        aria-live="polite"
        className="w-full"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? t("authResendSending") : t("authResetRequest")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link
          className="font-medium text-foreground underline"
          href="/login"
          replace
        >
          {t("authBackToLogin")}
        </Link>
      </p>
    </form>
  );
}
