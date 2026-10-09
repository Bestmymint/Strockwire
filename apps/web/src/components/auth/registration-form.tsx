"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { register } from "@/api-client";
import {
  clearContinuation,
  saveContinuation,
} from "@/verification-continuation-browser";
import { useLanguage } from "@/providers/language-provider";

import { hasEmailShape, passwordValidationMessage } from "./auth-form-support";
import { verificationErrorMessage } from "./auth-copy";

export function RegistrationForm() {
  const router = useRouter();
  const { t } = useLanguage();
  const pending = useRef(false);
  const errorMessage = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);
  useEffect(() => {
    if (error !== null) errorMessage.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || isAccepted) {
      return;
    }

    if (!hasEmailShape(email)) {
      setError(t("authInvalidEmail"));
      return;
    }

    const passwordError = passwordValidationMessage(password);
    if (passwordError !== null) {
      setError(t("authPasswordLength"));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    pending.current = true;
    clearContinuation();

    try {
      const result = await register({ email, password });
      saveContinuation({
        version: 1,
        canonicalEmail: email.trim().toLowerCase(),
        challengeId: result.data.verification.challengeId,
        savedAt: Date.now(),
      });
      setPassword("");
      setEmail("");
      setIsAccepted(true);
      router.push("/verify-email");
    } catch (requestError: unknown) {
      setError(verificationErrorMessage(requestError, t));
    } finally {
      setIsSubmitting(false);
      pending.current = false;
    }
  }

  if (isAccepted) {
    return (
      <div aria-live="polite">
        <p className="text-sm leading-6 text-muted-foreground">
          {t("authAccepted")}
        </p>
        <Link className="underline" href="/verify-email">
          {t("authVerify")}
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <Label className="form-field" htmlFor="registration-email">
          {t("authEmail")}
        </Label>
        <Input
          aria-describedby={error !== null ? "registration-error" : undefined}
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
          {t("authPassword")}
        </Label>
        <Input
          aria-describedby={error !== null ? "registration-error" : undefined}
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
          {t("authPasswordLength")}
        </p>
      </div>
      {error === null ? null : (
        <Alert
          variant="destructive"
          aria-live="assertive"
          id="registration-error"
          ref={errorMessage}
          tabIndex={-1}
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? t("authCreatingAccount") : t("authCreateAccount")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("authAlreadyAccount")}{" "}
        <Link className="font-medium text-foreground underline" href="/login">
          {t("authSignIn")}
        </Link>
      </p>
    </form>
  );
}
