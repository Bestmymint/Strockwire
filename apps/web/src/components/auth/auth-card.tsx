"use client";

import { type ReactNode, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

interface AuthCardProps {
  children: ReactNode;
  description: string;
  title: string;
  focusOnMount?: boolean;
}

export function AuthCard({
  children,
  description,
  title,
  focusOnMount = false,
}: AuthCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Guest guards can mount the card after Next's navigation focus ran.
    // Preserve focus already owned by a field or accessible error/status.
    if (
      focusOnMount &&
      !document.activeElement?.closest("form, [role=alert], [role=status]")
    )
      heading.current?.focus();
  }, [focusOnMount]);
  return (
    <Card className="mx-auto w-full max-w-sm self-center">
      <CardHeader>
        <h1
          ref={heading}
          tabIndex={focusOnMount ? -1 : undefined}
          className="text-2xl font-semibold tracking-tight"
        >
          {title}
        </h1>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
