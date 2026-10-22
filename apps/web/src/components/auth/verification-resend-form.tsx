"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { resendVerification } from "@/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/providers/language-provider";
import {
  clearContinuation,
  getContinuationRevision,
  loadContinuation,
  saveContinuation,
} from "@/verification-continuation-browser";
import { verificationErrorMessage } from "./auth-copy";
import { hasEmailShape } from "./auth-form-support";

export function VerificationResendForm() {
  const router = useRouter();
  const { t } = useLanguage();
  const pending = useRef(false);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalidEmail, setInvalidEmail] = useState(false);
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    function restore() {
      mounted.current = true;
      pending.current = false;
      setBusy(false);
      setEmail(loadContinuation().continuation?.canonicalEmail ?? "");
      setReady(true);
    }
    function abandon() {
      mounted.current = false;
      requestId.current += 1;
      controller.current?.abort();
      controller.current = null;
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) restore();
    }
    restore();
    window.addEventListener("pagehide", abandon);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      abandon();
      window.removeEventListener("pagehide", abandon);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  useEffect(() => {
    if (error !== null || invalidEmail || accepted) message.current?.focus();
  }, [error, invalidEmail, accepted]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !ready || accepted) return;
    if (!hasEmailShape(email)) {
      setInvalidEmail(true);
      return;
    }
    pending.current = true;
    setBusy(true);
    setInvalidEmail(false);
    setError(null);
    const canonicalEmail = email.trim().toLowerCase();
    const previous = loadContinuation().continuation;
    if (previous?.canonicalEmail !== canonicalEmail) clearContinuation();
    const continuation = loadContinuation().continuation;
    const revision = getContinuationRevision();
    const id = ++requestId.current;
    const abortController = new AbortController();
    controller.current = abortController;
    const isCurrent = () => {
      const current = loadContinuation().continuation;
      return (
        mounted.current &&
        requestId.current === id &&
        getContinuationRevision() === revision &&
        (continuation === null
          ? current === null
          : current !== null &&
            current.version === continuation.version &&
            current.canonicalEmail === continuation.canonicalEmail &&
            current.challengeId === continuation.challengeId &&
            current.savedAt === continuation.savedAt)
      );
    };
    try {
      const result = await resendVerification(
        { email: canonicalEmail },
        { signal: abortController.signal },
      );
      if (!isCurrent()) return;
      const saved = saveContinuation({
        version: 1,
        canonicalEmail,
        challengeId: result.data.verification.challengeId,
        savedAt:
          previous?.canonicalEmail === canonicalEmail
            ? previous.savedAt
            : Date.now(),
      });
      setAccepted(true);
      if (saved) router.replace("/verify-email");
    } catch (requestError: unknown) {
      if (isCurrent()) setError(requestError);
    } finally {
      if (requestId.current === id) {
        pending.current = false;
        controller.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  if (accepted)
    return (
      <div className="space-y-5">
        <p ref={message} role="status" tabIndex={-1}>
          {t("authResendAccepted")}
        </p>
        <Link className="underline" href="/login" replace>
          {t("authBackToLogin")}
        </Link>
      </div>
    );
  return (
    <form className="space-y-5" noValidate onSubmit={submit}>
      <div>
        <Label htmlFor="resend-email">{t("authEmail")}</Label>
        <Input
          aria-describedby={
            error !== null || invalidEmail ? "resend-error" : undefined
          }
          aria-invalid={invalidEmail}
          autoComplete="email"
          disabled={!ready || busy}
          id="resend-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      {(error !== null || invalidEmail) && (
        <p
          className="text-sm text-destructive"
          id="resend-error"
          ref={message}
          role="alert"
          tabIndex={-1}
        >
          {invalidEmail
            ? t("authInvalidEmail")
            : verificationErrorMessage(error, t)}
        </p>
      )}
      <Button className="w-full" disabled={!ready || busy} type="submit">
        {busy ? t("authResendSending") : t("authResendButton")}
      </Button>
      <Link
        className="block text-center text-sm underline"
        href="/login"
        onClick={clearContinuation}
        replace
      >
        {t("authBackToLogin")}
      </Link>
    </form>
  );
}
