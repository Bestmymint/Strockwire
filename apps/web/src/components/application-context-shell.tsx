"use client";
import { useLanguage } from "@/providers/language-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { fetchAccessContext } from "@/branch-api-client";
import {
  applicationContextUrl,
  clearPreviousBranchQueries,
  resolveApplicationContext,
} from "@/application-context";

export function ApplicationContextShell() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const requestedOrganizationId = searchParams.get("organizationId");
  const requestedBranchId = searchParams.get("branchId");
  const contextQuery = useQuery({
    queryFn: fetchAccessContext,
    queryKey: ["access-context"],
  });
  const resolved = contextQuery.data
    ? resolveApplicationContext(
        contextQuery.data,
        requestedOrganizationId,
        requestedBranchId,
      )
    : null;

  useEffect(() => {
    if (resolved?.organization === null) return;
    if (resolved?.organization === undefined) return;
    const canonicalUrl = applicationContextUrl(
      resolved.organization.id,
      resolved.branch?.id ?? null,
    );
    const currentUrl = applicationContextUrl(
      requestedOrganizationId ?? "",
      requestedBranchId,
    );
    if (canonicalUrl !== currentUrl) {
      void clearPreviousBranchQueries(
        queryClient,
        requestedOrganizationId,
        requestedBranchId,
      ).then(() => router.replace(canonicalUrl));
    }
  }, [
    queryClient,
    requestedBranchId,
    requestedOrganizationId,
    resolved,
    router,
  ]);

  useEffect(() => {
    if (
      contextQuery.data?.organizations.length === 0 &&
      contextQuery.data.firstOrganizationOnboarding.eligible
    ) {
      router.replace("/onboarding");
    }
  }, [contextQuery.data, router]);

  async function switchTo(organizationId: string, branchId: string | null) {
    await clearPreviousBranchQueries(
      queryClient,
      requestedOrganizationId,
      requestedBranchId,
    );
    router.replace(applicationContextUrl(organizationId, branchId));
  }

  if (contextQuery.isPending)
    return <p aria-live="polite">{t("loadingAccess")}</p>;
  if (contextQuery.isError)
    return (
      <p className="form-message" role="alert">
        {t("accessError")}
      </p>
    );
  if (resolved?.organization === null) {
    if (contextQuery.data.organizations.length === 0) {
      if (contextQuery.data.firstOrganizationOnboarding.eligible) {
        return <p aria-live="polite">{t("openingSetup")}</p>;
      }
      return (
        <section className="space-y-5">
          <h1 className="text-2xl font-semibold">{t("noOrganization")}</h1>
          <p className="text-muted-foreground">{t("restoreAccess")}</p>
        </section>
      );
    }
    return (
      <section className="w-full max-w-xl space-y-5">
        <h1 className="text-2xl font-semibold">{t("chooseOrganization")}</h1>
        <div className="grid gap-3">
          {contextQuery.data.organizations.map((organization) => (
            <Button
              variant="outline"
              className="text-left"
              key={organization.id}
              onClick={() =>
                void switchTo(
                  organization.id,
                  organization.branches[0]?.id ?? null,
                )
              }
              type="button"
            >
              {organization.name}
            </Button>
          ))}
        </div>
      </section>
    );
  }

  if (resolved === null) return null;
  const activeOrganization = resolved.organization;
  return (
    <section className="w-full space-y-8">
      <div className="rounded-lg border bg-card p-5 sm:p-7">
        <p className="text-sm text-muted-foreground">{t("workspace")}</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {activeOrganization.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(activeOrganization.role)}
        </p>
        <div className="mt-5 grid max-w-4xl gap-4 sm:grid-cols-2">
          <Label className="form-field">
            {t("organization")}
            <NativeSelect
              className="w-full "
              onChange={(event) => {
                const organization = contextQuery.data.organizations.find(
                  ({ id }) => id === event.target.value,
                );
                if (organization)
                  void switchTo(
                    organization.id,
                    organization.branches[0]?.id ?? null,
                  );
              }}
              value={activeOrganization.id}
            >
              {contextQuery.data.organizations.map((organization) => (
                <NativeSelectOption
                  key={organization.id}
                  value={organization.id}
                >
                  {organization.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label className="form-field">
            {t("branch")}
            <NativeSelect
              className="w-full "
              disabled={activeOrganization.branches.length === 0}
              onChange={(event) =>
                void switchTo(activeOrganization.id, event.target.value)
              }
              value={resolved.branch?.id ?? ""}
            >
              {activeOrganization.branches.length === 0 ? (
                <NativeSelectOption value="">
                  {t("noBranch")}
                </NativeSelectOption>
              ) : null}
              {activeOrganization.branches.map((branch) => (
                <NativeSelectOption key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
        </div>
      </div>
    </section>
  );
}
