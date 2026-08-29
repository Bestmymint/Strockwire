"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { fetchAccessContext } from "@/branch-api-client";
import { AuthCard } from "@/components/auth/auth-card";
import { OnboardingForm } from "@/components/auth/onboarding-form";

export default function OnboardingPage() {
  const router = useRouter();
  const contextQuery = useQuery({
    queryFn: fetchAccessContext,
    queryKey: ["access-context"],
  });
  const eligible =
    contextQuery.data?.organizations.length === 0 &&
    contextQuery.data.firstOrganizationOnboarding.eligible;

  useEffect(() => {
    if (contextQuery.data !== undefined && !eligible) {
      router.replace("/app");
    }
  }, [contextQuery.data, eligible, router]);

  if (contextQuery.isPending) {
    return <p aria-live="polite">Loading access…</p>;
  }
  if (contextQuery.isError) {
    return <p role="alert">Your access context could not be loaded.</p>;
  }
  if (!eligible) {
    return <p aria-live="polite">Opening workspace…</p>;
  }

  return (
    <AuthCard
      description="Complete your profile and create your first organization and branch."
      title="Set up StockWise"
    >
      <OnboardingForm />
    </AuthCard>
  );
}
