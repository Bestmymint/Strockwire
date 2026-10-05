"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { BranchApiError, fetchAccessContext } from "@/branch-api-client";
import {
  applicationContextUrl,
  resolveApplicationContext,
} from "@/application-context";
import { LogoutButton } from "@/components/auth/logout-button";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
}

const linkClassName =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const logoClassName =
  "w-fit rounded-sm text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

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
  const [menuOpen, setMenuOpen] = useState(false);
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
  const destinations = [{ label: "Home", path: "/app", visible: true }];
  if (organization) {
    destinations.push(
      { label: "Catalog", path: "/app/catalog", visible: true },
      { label: "Inventory", path: "/app/inventory", visible: !!branch },
      {
        label: "Point of sale",
        path: "/app/pos",
        visible: !!branch && organization.role !== "INVENTORY_STAFF",
      },
      {
        label: "Analytics",
        path: "/app/analytics",
        visible: organization.role !== "CASHIER" && (canManage || !!branch),
      },
      {
        label: "Sales history",
        path: "/app/sales",
        visible: !!branch && organization.role !== "INVENTORY_STAFF",
      },
      {
        label: "Suppliers",
        path: "/app/suppliers",
        visible: organization.role !== "CASHIER",
      },
      {
        label: "Purchase orders",
        path: "/app/purchase-orders",
        visible: !!branch && organization.role !== "CASHIER",
      },
      { label: "Manage branches", path: "/app/branches", visible: canManage },
      { label: "Manage members", path: "/app/members", visible: canManage },
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-background text-foreground",
        context && "lg:flex-row",
      )}
    >
      <a
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        href="#main-content"
      >
        Skip to main content
      </a>

      {context ? (
        <>
          <header className="flex min-h-16 items-center justify-between gap-3 border-b bg-card px-4 lg:hidden">
            <Link className={logoClassName} href={homeUrl}>
              StockWise
            </Link>
            <button
              aria-controls="application-navigation"
              aria-expanded={menuOpen}
              className={cn(linkClassName, "border border-border")}
              onClick={() => setMenuOpen(!menuOpen)}
              type="button"
            >
              {menuOpen ? "Close menu" : "Menu"}
            </button>
          </header>
          <aside
            aria-label="Application sidebar"
            className={cn(
              "flex-col gap-6 border-b bg-card p-4 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-5",
              menuOpen ? "flex" : "hidden",
            )}
          >
            <Link
              className={cn(logoClassName, "hidden lg:block")}
              href={homeUrl}
            >
              StockWise
            </Link>
            <nav
              aria-label="Primary navigation"
              className="flex flex-col gap-1"
              id="application-navigation"
            >
              {destinations
                .filter(({ visible }) => visible)
                .map(({ label, path }) => (
                  <Link
                    aria-current={pathname === path ? "page" : undefined}
                    className={cn(
                      linkClassName,
                      pathname === path
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    href={path === "/app" ? homeUrl : path + homeUrl.slice(4)}
                    key={path}
                    onClick={() => setMenuOpen(false)}
                  >
                    {label}
                  </Link>
                ))}
            </nav>
            <div className="mt-auto space-y-3 border-t pt-4">
              <p className="break-words text-sm text-muted-foreground">
                {context.user.displayName ?? context.user.email}
              </p>
              <LogoutButton />
            </div>
          </aside>
        </>
      ) : (
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link className={logoClassName} href="/">
              StockWise
            </Link>
            <nav aria-label="Primary navigation">
              {signedOut ? (
                <Link
                  className={cn(
                    linkClassName,
                    "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  href="/login"
                >
                  Sign in
                </Link>
              ) : null}
            </nav>
          </div>
        </header>
      )}

      <main
        className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12"
        id="main-content"
      >
        {checkingSession ? (
          <p aria-live="polite">Loading access…</p>
        ) : openingWorkspace ? (
          <p aria-live="polite">Opening workspace…</p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
