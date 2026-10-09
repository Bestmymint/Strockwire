"use client";

import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  AuthApiError,
  verificationPasswordProof,
  verifyEmail,
  verifyEmailCode,
} from "@/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/providers/language-provider";
import type { VerificationContinuation } from "@/verification-continuation";
import type { VerificationLinkWindow } from "@/verification-link-entry";
import {
  clearContinuation,
  getContinuationRevision,
  loadContinuation,
} from "@/verification-continuation-browser";
import { verificationErrorMessage } from "./auth-copy";
import { hasEmailShape, passwordValidationMessage } from "./auth-form-support";
import { OtpInput } from "./otp-input";

type MailboxCredential =
  | { kind: "link"; token: string }
  | { kind: "code"; email: string; challengeId: string; code: string };

interface VerificationRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
}

export function VerificationForm() {
  const { t } = useLanguage();
  const initialized = useRef(false);
  const mailbox = useRef<MailboxCredential | null>(null);
  const token = useRef<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const flow = useRef<{
    revision: number;
    continuation: VerificationContinuation | null;
  } | null>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const [ready, setReady] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [continuation, setContinuation] =
    useState<VerificationContinuation | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsProof, setNeedsProof] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [inputError, setInputError] = useState<
    "authOtpInvalid" | "authInvalidEmail" | "authPasswordLength" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);

  // Token-bearing documents are intercepted before Next can serialize the URL.
  // The clean document consumes the bootstrap's one-use memory handoff.
  useLayoutEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const captured = (
      window as VerificationLinkWindow
    ).__stockwiseTakeVerificationLink?.();
    if (captured !== undefined) {
      setIsLink(true);
      clearContinuation();
      token.current = captured.token;
      if (captured.token === null) setError(new AuthApiError("invalid_token"));
    } else {
      const saved = loadContinuation().continuation;
      setContinuation(saved);
      setEmail(saved?.canonicalEmail ?? "");
    }
    flow.current = {
      revision: getContinuationRevision(),
      continuation: loadContinuation().continuation,
    };
    setReady(true);
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    function invalidate() {
      requestId.current += 1;
      controller.current?.abort();
      controller.current = null;
      pending.current = false;
      mailbox.current = null;
    }
    function abandon() {
      invalidate();
      token.current = null;
      setCode("");
      setPassword("");
      setNeedsProof(false);
      setBusy(false);
      setContinuation(null);
      mounted.current = false;
    }
    window.addEventListener("pagehide", abandon);
    return () => {
      mounted.current = false;
      invalidate();
      // StrictMode replays setup synchronously. Real unmount still discards
      // the unused handoff, without destroying it during that setup probe.
      queueMicrotask(() => {
        if (!mounted.current) token.current = null;
      });
      window.removeEventListener("pagehide", abandon);
    };
  }, []);

  const isFlowCurrent = useCallback(() => {
    const expected = flow.current;
    if (!mounted.current || expected === null) return false;
    const current = loadContinuation().continuation;
    return (
      getContinuationRevision() === expected.revision &&
      (expected.continuation === null
        ? current === null
        : current !== null &&
          current.version === expected.continuation.version &&
          current.canonicalEmail === expected.continuation.canonicalEmail &&
          current.challengeId === expected.continuation.challengeId &&
          current.savedAt === expected.continuation.savedAt)
    );
  }, []);

  function beginRequest(): VerificationRequest {
    const id = ++requestId.current;
    const abortController = new AbortController();
    controller.current = abortController;
    return {
      signal: abortController.signal,
      isCurrent: () => requestId.current === id && isFlowCurrent(),
      finish: () => {
        if (requestId.current !== id || !mounted.current) return;
        pending.current = false;
        controller.current = null;
        if (isFlowCurrent()) setBusy(false);
      },
    };
  }

  useEffect(() => {
    if (error !== null || inputError !== null || needsProof || verified)
      message.current?.focus();
  }, [error, inputError, needsProof, verified]);

  useEffect(() => {
    if (continuation === null) return;
    function expire() {
      if (!mounted.current) return;
      if (isFlowCurrent()) clearContinuation();
      requestId.current += 1;
      controller.current?.abort();
      controller.current = null;
      pending.current = false;
      setBusy(false);
      setContinuation(null);
      setCode("");
      setEmail("");
      setPassword("");
      mailbox.current = null;
      setNeedsProof(false);
    }
    const timer = window.setTimeout(
      expire,
      Math.max(0, continuation.savedAt + 30 * 60_000 - Date.now()),
    );
    function revalidate() {
      if (!isFlowCurrent()) expire();
    }
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [continuation, isFlowCurrent]);

  async function complete(
    credential: MailboxCredential,
    request: VerificationRequest,
  ) {
    if (!request.isCurrent()) return;
    try {
      if (credential.kind === "link")
        await verifyEmail(
          { token: credential.token },
          { signal: request.signal },
        );
      else
        await verifyEmailCode(
          {
            email: credential.email,
            challengeId: credential.challengeId,
            code: credential.code,
          },
          { signal: request.signal },
        );
      if (!request.isCurrent()) return;
      clearContinuation();
      token.current = null;
      mailbox.current = null;
      setContinuation(null);
      setCode("");
      setEmail("");
      setPassword("");
      setNeedsProof(false);
      setBusy(false);
      setVerified(true);
    } catch (requestError: unknown) {
      if (!request.isCurrent()) return;
      if (
        requestError instanceof AuthApiError &&
        requestError.kind === "verification_password_proof_required"
      ) {
        mailbox.current = credential;
        setNeedsProof(true);
      } else {
        mailbox.current = null;
        setNeedsProof(false);
        setCode("");
        if (
          requestError instanceof AuthApiError &&
          requestError.kind === "invalid_token"
        )
          token.current = null;
        setError(requestError);
      }
    }
  }

  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || verified || needsProof || !isFlowCurrent()) return;
    let credential: MailboxCredential;
    if (isLink) {
      if (token.current === null) return;
      credential = { kind: "link", token: token.current };
    } else {
      const saved = loadContinuation().continuation;
      if (
        saved === null ||
        continuation === null ||
        saved.savedAt !== continuation.savedAt ||
        saved.canonicalEmail !== continuation.canonicalEmail ||
        saved.challengeId !== continuation.challengeId
      ) {
        setContinuation(null);
        setCode("");
        setEmail("");
        return;
      }
      if (saved.challengeId === null) return;
      if (!/^[0-9]{6}$/.test(code)) {
        setInputError("authOtpInvalid");
        return;
      }
      credential = {
        kind: "code",
        email: saved.canonicalEmail,
        challengeId: saved.challengeId,
        code,
      };
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setInputError(null);
    const request = beginRequest();
    try {
      await complete(credential, request);
    } finally {
      request.finish();
    }
  }

  async function handleProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = mailbox.current;
    if (
      pending.current ||
      credential === null ||
      !needsProof ||
      !isFlowCurrent()
    )
      return;
    if (!hasEmailShape(email)) {
      setInputError("authInvalidEmail");
      return;
    }
    if (passwordValidationMessage(password) !== null) {
      setInputError("authPasswordLength");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setInputError(null);
    const submittedPassword = password;
    setPassword("");
    const request = beginRequest();
    try {
      await verificationPasswordProof(
        {
          email: email.trim().toLowerCase(),
          password: submittedPassword,
        },
        { signal: request.signal },
      );
      // Exactly one retry of the same active mailbox credential; no session call.
      if (request.isCurrent() && mailbox.current === credential)
        await complete(credential, request);
    } catch (requestError: unknown) {
      if (request.isCurrent()) setError(requestError);
    } finally {
      request.finish();
    }
  }

  if (!ready) return <p role="status">{t("loading")}</p>;
  if (verified)
    return (
      <div className="space-y-5">
        <p ref={message} role="status" tabIndex={-1}>
          {t("authVerified")}
        </p>
        <Link className="underline" href="/login">
          {t("authSignIn")}
        </Link>
      </div>
    );

  const errorText =
    inputError !== null
      ? t(inputError)
      : error !== null
        ? verificationErrorMessage(error, t)
        : null;
  const canVerify = isLink
    ? token.current !== null
    : continuation?.challengeId != null;
  return (
    <div className="space-y-5">
      {errorText !== null && (
        <p
          className="text-sm text-destructive"
          id="verification-error"
          ref={message}
          role="alert"
          tabIndex={-1}
        >
          {errorText}
        </p>
      )}
      {needsProof ? (
        <form className="space-y-4" noValidate onSubmit={handleProof}>
          <p
            ref={errorText === null ? message : undefined}
            role="status"
            tabIndex={-1}
          >
            {t("authProofRequired")}
          </p>
          {isLink && (
            <div>
              <Label htmlFor="proof-email">{t("authEmail")}</Label>
              <Input
                autoComplete="email"
                disabled={busy}
                id="proof-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
          )}
          <div>
            <Label htmlFor="proof-password">{t("authProofPassword")}</Label>
            <Input
              aria-describedby={
                errorText !== null ? "verification-error" : undefined
              }
              autoComplete="current-password"
              disabled={busy}
              id="proof-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? t("authVerifying") : t("authProofSubmit")}
          </Button>
        </form>
      ) : canVerify ? (
        <form className="space-y-5" noValidate onSubmit={handleVerification}>
          <p className="break-words text-sm text-muted-foreground">
            {isLink
              ? t("authVerifyLinkDescription")
              : t("authVerifyOtpDescription").replace(
                  "{email}",
                  continuation?.canonicalEmail ?? "",
                )}
          </p>
          {!isLink && (
            <div>
              <Label htmlFor="verification-code">{t("authOtpLabel")}</Label>
              <OtpInput
                describedBy={
                  errorText !== null
                    ? "verification-error verification-safety"
                    : "verification-safety"
                }
                disabled={busy}
                id="verification-code"
                invalid={errorText !== null}
                onChange={(value) => {
                  setCode(value);
                  setInputError(null);
                }}
                value={code}
              />
              <p
                className="mt-2 text-xs text-muted-foreground"
                id="verification-safety"
              >
                {t("authOtpSafety")}
              </p>
            </div>
          )}
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? t("authVerifying") : t("authVerify")}
          </Button>
        </form>
      ) : (
        !isLink && (
          <p role="status">
            {t(continuation === null ? "authRecovery" : "authNoChallenge")}
          </p>
        )
      )}
      {!busy && (
        <div className="flex flex-wrap justify-between gap-4 text-sm">
          <Link className="underline" href="/verification-resend">
            {t("authResendLink")}
          </Link>
          <Link className="underline" href="/login" onClick={clearContinuation}>
            {t("authBackToLogin")}
          </Link>
        </div>
      )}
    </div>
  );
}
