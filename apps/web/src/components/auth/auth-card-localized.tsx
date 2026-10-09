"use client";

import type { ReactNode } from "react";
import type { TranslationKey } from "@/i18n/en";
import { useLanguage } from "@/providers/language-provider";

import { AuthCard } from "./auth-card";

interface AuthCardLocalizedProps {
  children: ReactNode;
  descriptionKey: TranslationKey;
  titleKey: TranslationKey;
}

export function AuthCardLocalized({
  children,
  descriptionKey,
  titleKey,
}: AuthCardLocalizedProps) {
  const { t } = useLanguage();
  return (
    <AuthCard description={t(descriptionKey)} title={t(titleKey)}>
      {children}
    </AuthCard>
  );
}
