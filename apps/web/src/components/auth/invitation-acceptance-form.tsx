"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { notifySessionChange } from "@/session-lifecycle";
import { type FormEvent, useLayoutEffect, useRef, useState } from "react";

import { acceptInvitation, MembershipApiError } from "@/membership-api-client";
import type { CredentialLinkWindow } from "@/credential-link-entry";
import { Button } from "@/components/ui/button";

export function InvitationAcceptanceForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useRef<string | null>(null);
  const mounted = useRef(false);
  const initialized = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuthentication, setNeedsAuthentication] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useLayoutEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      const captured = (
        window as CredentialLinkWindow
      ).__stockwiseTakeCredentialLink?.();
      token.current =
        captured?.route === "/accept-invitation" ? captured.token : null;
      if (token.current === null)
        setError("This invitation is invalid or expired.");
    }
    function abandon() {
      mounted.current = false;
      token.current = null;
      setIsSubmitting(false);
    }
    window.addEventListener("pagehide", abandon);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", abandon);
      queueMicrotask(() => {
        if (!mounted.current) token.current = null;
      });
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const credential = token.current;
    if (!credential) {
      setError("This invitation is invalid or expired.");
      return;
    }
    setError(null);
    setNeedsAuthentication(false);
    setIsSubmitting(true);
    try {
      const result = await acceptInvitation(credential);
      if (!mounted.current || token.current !== credential) return;
      token.current = null;
      // The accepted invitation changes membership authority; discard all
      // cached roles, organizations and branch state before navigating.
      notifySessionChange(queryClient);
      router.replace(
        `/app?organizationId=${encodeURIComponent(result.membership.organization.id)}`,
      );
    } catch (requestError: unknown) {
      if (!mounted.current || token.current !== credential) return;
      if (
        requestError instanceof MembershipApiError &&
        requestError.kind === "authentication_required"
      ) {
        setNeedsAuthentication(true);
        setError(
          "Sign in or register with the invited email, verify it, then reopen this invitation link.",
        );
      } else {
        if (
          requestError instanceof MembershipApiError &&
          (requestError.kind === "invalid_invitation" ||
            requestError.kind === "invitation_scope_invalid")
        ) {
          token.current = null;
        }
        setError(
          requestError instanceof MembershipApiError &&
            requestError.kind === "invitation_scope_invalid"
            ? "The invitation branch access is not currently available. Ask an organization administrator to review it."
            : requestError instanceof MembershipApiError &&
                requestError.kind === "invalid_invitation"
              ? "This invitation is invalid or expired."
              : "Unable to accept this invitation right now. Please try again.",
        );
      }
    } finally {
      if (mounted.current) setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <p className="text-sm leading-6 text-muted-foreground">
        Accept this invitation while signed in with the verified invited email.
      </p>
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
        {isSubmitting ? "Accepting invitation…" : "Accept invitation"}
      </Button>
      {needsAuthentication ? (
        <div className="flex justify-center gap-4 text-sm">
          <Link className="font-medium underline" href="/login" replace>
            Sign in
          </Link>
          <Link className="font-medium underline" href="/register" replace>
            Register
          </Link>
        </div>
      ) : null}
    </form>
  );
}
