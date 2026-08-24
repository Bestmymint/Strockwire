import { ApiHealthStatus } from "@/components/api-health-status";
import Link from "next/link";

export default function HomePage() {
  return (
    <section className="max-w-2xl self-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Application foundation
      </p>
      <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        StockWise web shell
      </h1>
      <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
        Sign in or create an account to begin the available identity workflow.
      </p>
      <div className="mt-6 text-sm text-muted-foreground">
        <ApiHealthStatus />
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          className="inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/register"
        >
          Create account
        </Link>
        <Link
          className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/login"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
