import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { QueryProvider } from "@/providers/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  description: "StockWise retail operations platform",
  title: "StockWise",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <Suspense fallback={<p aria-live="polite">Loading StockWise…</p>}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </QueryProvider>
      </body>
    </html>
  );
}
