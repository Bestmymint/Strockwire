import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        className={cn(
          "fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background",
          "focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        )}
        href="#main-content"
      >
        Skip to main content
      </a>

      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-col justify-center gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link
            className="w-fit rounded-sm text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href="/"
          >
            StockWise
          </Link>

          <nav aria-label="Primary navigation">
            <Link
              aria-current="page"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href="/"
            >
              Home
            </Link>
          </nav>
        </div>
      </header>

      <main
        className="mx-auto flex w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16"
        id="main-content"
      >
        {children}
      </main>
    </div>
  );
}
