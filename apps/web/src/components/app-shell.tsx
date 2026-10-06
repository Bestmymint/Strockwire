"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { BranchApiError, fetchAccessContext } from "@/branch-api-client";
import {
  applicationContextUrl,
  resolveApplicationContext,
} from "@/application-context";
import { LogoutButton } from "@/components/auth/logout-button";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  Home,
  Package,
  Receipt,
  ShoppingCart,
  Store,
  Users,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { PreferenceControls } from "@/components/preference-controls";
import { useLanguage } from "@/providers/language-provider";
import type {
  AccessContext,
  AccessibleOrganization,
} from "@/branch-api-client";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/pricing") {
    return <MarketingShell key={pathname}>{children}</MarketingShell>;
  }
  return <WorkspaceShell>{children}</WorkspaceShell>;
}

function WorkspaceShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLanguage();
  const contextQuery = useQuery({
    queryFn: fetchAccessContext,
    queryKey: ["access-context"],
    retry: false,
  });
  const context = contextQuery.isError ? undefined : contextQuery.data;
  const resolved = context
    ? resolveApplicationContext(
        context,
        searchParams.get("organizationId"),
        searchParams.get("branchId"),
      )
    : null;
  const organization = resolved?.organization;
  const branch = resolved?.branch;
  const homeUrl = organization
    ? applicationContextUrl(organization.id, branch?.id ?? null)
    : "/app";
  const openingWorkspace = context !== undefined && pathname === "/login";
  const checkingSession = contextQuery.isPending && pathname === "/login";
  const signedOut =
    contextQuery.error instanceof BranchApiError &&
    contextQuery.error.kind === "authentication_required";

  useEffect(() => {
    if (openingWorkspace) router.replace(homeUrl);
  }, [homeUrl, openingWorkspace, router]);

  const canManage =
    organization?.role === "OWNER" || organization?.role === "ADMIN";
  const destinations = [{ label: t("home"), path: "/app", visible: true }];
  if (organization) {
    destinations.push(
      { label: t("catalog"), path: "/app/catalog", visible: true },
      { label: t("inventory"), path: "/app/inventory", visible: !!branch },
      {
        label: t("pos"),
        path: "/app/pos",
        visible: !!branch && organization.role !== "INVENTORY_STAFF",
      },
      {
        label: t("analytics"),
        path: "/app/analytics",
        visible: organization.role !== "CASHIER" && (canManage || !!branch),
      },
      {
        label: t("sales"),
        path: "/app/sales",
        visible: !!branch && organization.role !== "INVENTORY_STAFF",
      },
      {
        label: t("suppliers"),
        path: "/app/suppliers",
        visible: organization.role !== "CASHIER",
      },
      {
        label: t("purchaseOrders"),
        path: "/app/purchase-orders",
        visible: !!branch && organization.role !== "CASHIER",
      },
      { label: t("branches"), path: "/app/branches", visible: canManage },
      { label: t("members"), path: "/app/members", visible: canManage },
    );
  }

  const content = (
    <div
      className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 px-4 py-6 sm:px-6"
      id="main-content"
    >
      {checkingSession ? (
        <p aria-live="polite">{t("loadingAccess")}</p>
      ) : openingWorkspace ? (
        <p aria-live="polite">{t("openingWorkspace")}</p>
      ) : (
        children
      )}
    </div>
  );
  const skip = (
    <a
      className="fixed left-4 top-2 z-[100] -translate-y-24 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:translate-y-0"
      href="#main-content"
    >
      {t("skip")}
    </a>
  );
  if (!context)
    return (
      <div className="flex min-h-screen flex-col">
        {skip}
        <header className="border-b">
          <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <Link
              className="flex items-center gap-2 text-lg font-semibold"
              href="/"
            >
              <Package className="size-5" aria-hidden="true" />
              StockWise
            </Link>
            <nav
              aria-label={t("primaryNavigation")}
              className="flex items-center gap-1"
            >
              <PreferenceControls />
              {signedOut && (
                <Button
                  variant="ghost"
                  nativeButton={false}
                  role="link"
                  render={<Link href="/login" />}
                >
                  {t("signIn")}
                </Button>
              )}
            </nav>
          </div>
        </header>
        <main className="flex min-w-0 flex-1">{content}</main>
      </div>
    );
  return (
    <SidebarProvider>
      {skip}
      <WorkspaceNavigation
        context={context}
        organization={organization}
        branch={branch}
        homeUrl={homeUrl}
        destinations={destinations.filter(({ visible }) => visible)}
        pathname={pathname}
      />
      <SidebarInset className="min-w-0">
        <WorkspaceHeader
          title={
            destinations.find((d) => d.path === pathname)?.label ??
            t("workspace")
          }
        />
        {content}
      </SidebarInset>
    </SidebarProvider>
  );
}

const destinationIcons: Record<string, LucideIcon> = {
  "/app": Home,
  "/app/catalog": Package,
  "/app/inventory": Boxes,
  "/app/pos": ShoppingCart,
  "/app/analytics": BarChart3,
  "/app/sales": Receipt,
  "/app/suppliers": Truck,
  "/app/purchase-orders": ClipboardList,
  "/app/branches": Store,
  "/app/members": Users,
};

function WorkspaceHeader({ title }: { title: string }) {
  const { t } = useLanguage();
  const { open, openMobile, isMobile } = useSidebar();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger
        aria-label={t("menu")}
        aria-expanded={isMobile ? openMobile : open}
      />
      <Separator orientation="vertical" className="h-4" />
      <span className="text-sm font-medium">{title}</span>
    </header>
  );
}

function WorkspaceNavigation({
  context,
  organization,
  branch,
  homeUrl,
  destinations,
  pathname,
}: {
  context: AccessContext;
  organization: AccessibleOrganization | null | undefined;
  branch: { code: string; name: string } | null | undefined;
  homeUrl: string;
  destinations: { label: string; path: string; visible: boolean }[];
  pathname: string;
}) {
  const { t } = useLanguage();
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="offcanvas" closeLabel={t("closeMenu")}>
      <aside aria-label={t("sidebar")} className="flex h-full min-h-0 flex-col">
        <SidebarHeader>
          <Link
            className="flex h-9 items-center gap-2 px-2 text-base font-semibold"
            href={homeUrl}
            onClick={() => setOpenMobile(false)}
          >
            <Package className="size-5" aria-hidden="true" />
            StockWise
          </Link>
          {organization && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("workspace")}</p>
              <p
                className="mt-1 truncate text-sm font-medium"
                title={organization.name}
              >
                {organization.name}
              </p>
              {branch && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {branch.code} · {branch.name}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {t(organization.role)}
              </p>
            </div>
          )}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t("operations")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <nav
                aria-label={t("primaryNavigation")}
                id="application-navigation"
              >
                <SidebarMenu>
                  {destinations.map(({ label, path }) => {
                    const Icon = destinationIcons[path] ?? Home;
                    return (
                      <SidebarMenuItem key={path}>
                        <SidebarMenuButton
                          isActive={pathname === path}
                          render={
                            <Link
                              href={
                                path === "/app"
                                  ? homeUrl
                                  : path + homeUrl.slice(4)
                              }
                              aria-current={
                                pathname === path ? "page" : undefined
                              }
                              onClick={() => setOpenMobile(false)}
                            />
                          }
                        >
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <Separator />
          <PreferenceControls />
          <p className="break-words px-2 text-xs text-muted-foreground">
            {context.user.displayName ?? context.user.email}
          </p>
          <LogoutButton />
        </SidebarFooter>
      </aside>
    </Sidebar>
  );
}
