import type { ReactNode } from "react";
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
}

export function AuthCard({ children, description, title }: AuthCardProps) {
  return (
    <Card className="mx-auto w-full max-w-sm self-center">
      <CardHeader>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
