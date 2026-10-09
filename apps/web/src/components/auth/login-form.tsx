"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { login } from "@/api-client";

import {
  clearContinuation,
  saveContinuation,
} from "@/verification-continuation-browser";
import { useLanguage } from "@/providers/language-provider";
import { hasEmailShape, passwordValidationMessage } from "./auth-form-support";
import { verificationErrorMessage } from "./auth-copy";

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const pending = useRef(false);
  const errorMessage = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    if (error !== null) errorMessage.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) {
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
      const result = await login({ email, password });
      setPassword("");
      queryClient.clear();
      if (result.outcome === "verification_required") {
        saveContinuation({
          version: 1,
          canonicalEmail: email.trim().toLowerCase(),
          challengeId: result.verification.challengeId,
          savedAt: Date.now(),
        });
        router.push("/verify-email");
      } else {
        router.push("/app");
      }
    } catch (requestError: unknown) {
      setError(verificationErrorMessage(requestError, t));
    } finally {
      setIsSubmitting(false);
      pending.current = false;
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <Label className="form-field" htmlFor="login-email">
          {t("authEmail")}
        </Label>
        <Input
          aria-describedby={error !== null ? "login-error" : undefined}
          autoComplete="email"
          className="mt-1"
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
          <Label className="form-field" htmlFor="login-password">
            {t("authPassword")}
          </Label>
          <Link className="text-sm underline" href="/forgot-password">
            {t("authForgotPassword")}
          </Link>
        </div>
        <Input
          aria-describedby={error !== null ? "login-error" : undefined}
          autoComplete="current-password"
          className="mt-1"
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
        <Alert
          variant="destructive"
          aria-live="assertive"
          id="login-error"
          ref={errorMessage}
          tabIndex={-1}
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? t("authSigningIn") : t("authSignIn")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("authNeedAccount")}{" "}
        <Link
          className="font-medium text-foreground underline"
          href="/register"
        >
          {t("authCreateOne")}
        </Link>
      </p>
    </form>
  );
}
