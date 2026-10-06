"use client";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { acceptInvitation, MembershipApiError } from "@/membership-api-client";

function tokenFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function removeTokenFromAddress(): void {
  window.history.replaceState(null, "", "/accept-invitation");
}

export function InvitationAcceptanceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsAuthentication, setNeedsAuthentication] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const token = tokenFromAddress();
    if (token === null || token.length === 0) {
      setError("This invitation is invalid or expired.");
      return;
    }

    setError(null);
    setNeedsAuthentication(false);
    setIsSubmitting(true);
    try {
      const result = await acceptInvitation(token);
      removeTokenFromAddress();
      router.replace(
        `/app?organizationId=${encodeURIComponent(result.membership.organization.id)}`,
      );
    } catch (requestError: unknown) {
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
          removeTokenFromAddress();
        }
        setError(
          requestError instanceof MembershipApiError &&
            requestError.kind === "invitation_scope_invalid"
            ? "The invitation branch access is not currently available. Ask an organization administrator to review it."
            : "This invitation is invalid or expired.",
        );
      }
    } finally {
      setIsSubmitting(false);
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
          <Link className="font-medium underline" href="/login">
            Sign in
          </Link>
          <Link className="font-medium underline" href="/register">
            Register
          </Link>
        </div>
      ) : null}
    </form>
  );
}
