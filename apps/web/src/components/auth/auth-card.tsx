import type { ReactNode } from "react";

interface AuthCardProps {
  children: ReactNode;
  description: string;
  title: string;
}

export function AuthCard({ children, description, title }: AuthCardProps) {
  return (
    <section className="mx-auto w-full max-w-md self-center rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
