"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logout } from "@/api-client";

import { authErrorMessage } from "./auth-form-support";

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    if (isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await logout();
      router.push("/login");
    } catch (requestError: unknown) {
      setError(authErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error === null ? null : (
        <p aria-live="assertive" className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="min-h-11 rounded-md border border-border px-4 text-sm font-medium outline-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        disabled={isSubmitting}
        onClick={handleLogout}
        type="button"
      >
        {isSubmitting ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
