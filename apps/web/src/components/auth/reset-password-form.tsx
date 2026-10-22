"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AuthApiError, resetPassword } from "@/api-client";
import type { CredentialLinkWindow } from "@/credential-link-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/providers/language-provider";
import { verificationErrorMessage } from "./auth-copy";
import { passwordValidationMessage } from "./auth-form-support";

export function ResetPasswordForm() {
  const { t } = useLanguage();
  const message = useRef<HTMLParagraphElement>(null);
  const token = useRef<string | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<
    | { kind: "invalid_link" }
    | { kind: "invalid_password" }
    | { kind: "request"; cause: unknown }
    | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReset, setIsReset] = useState(false);
  useEffect(() => {
    if (error !== null || isReset) message.current?.focus();
  }, [error, isReset]);

  useLayoutEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      const captured = (
        window as CredentialLinkWindow
      ).__stockwiseTakeCredentialLink?.();
      token.current =
        captured?.route === "/reset-password" ? captured.token : null;
      if (token.current === null) setError({ kind: "invalid_link" });
    }
    function abandon() {
      mounted.current = false;
      token.current = null;
      setNewPassword("");
      setIsSubmitting(false);
    }
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      mounted.current = true;
      // The one-use handoff was deliberately discarded on pagehide.
      if (token.current === null && !isReset)
        setError({ kind: "invalid_link" });
    }
    window.addEventListener("pagehide", abandon);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", abandon);
      window.removeEventListener("pageshow", restore);
      // StrictMode replays effects immediately; a real unmount discards the token.
      queueMicrotask(() => {
        if (!mounted.current) token.current = null;
      });
    };
  }, [isReset]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const credential = token.current;
    if (!credential) {
      setError({ kind: "invalid_link" });
      return;
    }
    const passwordError = passwordValidationMessage(newPassword);
    if (passwordError !== null) {
      setError({ kind: "invalid_password" });
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await resetPassword({ newPassword, token: credential });
      if (!mounted.current || token.current !== credential) return;
      token.current = null;
      setNewPassword("");
      setIsReset(true);
    } catch (requestError: unknown) {
      if (!mounted.current || token.current !== credential) return;
      if (
        requestError instanceof AuthApiError &&
        requestError.kind === "invalid_token"
      ) {
        token.current = null;
      }
      setError(
        requestError instanceof AuthApiError &&
          requestError.kind === "invalid_token"
          ? { kind: "invalid_link" }
          : { kind: "request", cause: requestError },
      );
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  }

  if (isReset) {
    return (
      <div>
        <p
          className="text-sm leading-6 text-muted-foreground"
          ref={message}
          role="status"
          tabIndex={-1}
        >
          {t("authResetComplete")}
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/login"
          replace
        >
          {t("authSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <div>
        <Label className="form-field" htmlFor="reset-password">
          {t("authNewPassword")}
        </Label>
        <Input
          aria-describedby={
            error === null
              ? "reset-password-requirements"
              : "reset-password-requirements reset-password-error"
          }
          aria-invalid={error?.kind === "invalid_password"}
          autoComplete="new-password"
          className="mt-1"
          disabled={isSubmitting}
          id="reset-password"
          name="new-password"
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
        <p
          className="mt-2 text-xs leading-5 text-muted-foreground"
          id="reset-password-requirements"
        >
          {t("authPasswordLength")}
        </p>
      </div>
      {error === null ? null : (
        <p
          aria-live="assertive"
          className="text-sm text-destructive form-message"
          id="reset-password-error"
          ref={message}
          tabIndex={-1}
          role="alert"
        >
          {error.kind === "invalid_link"
            ? t("authInvalidResetLink")
            : error.kind === "invalid_password"
              ? t("authPasswordLength")
              : verificationErrorMessage(error.cause, t)}
        </p>
      )}
      {error?.kind === "invalid_link" && (
        <Link
          className="block text-center text-sm underline"
          href="/forgot-password"
          replace
        >
          {t("authForgotPassword")}
        </Link>
      )}
      <Button
        aria-live="polite"
        className="w-full"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? t("authResettingPassword") : t("authResetPassword")}
      </Button>
    </form>
  );
}
