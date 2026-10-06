"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { en, type TranslationKey } from "@/i18n/en";
import { th } from "@/i18n/th";

type Language = "en" | "th";
const LanguageContext = createContext({
  language: "en" as Language,
  setLanguage: (language: Language) => {
    void language;
  },
  t: (key: TranslationKey): string => en[key],
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>("en");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("stockwise.language");
    } catch {
      /* Storage may be unavailable. */
    }
    updateLanguage(
      saved === "en" || saved === "th"
        ? saved
        : navigator.language.toLowerCase().startsWith("th")
          ? "th"
          : "en",
    );
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  function setLanguage(value: Language) {
    updateLanguage(value);
    try {
      localStorage.setItem("stockwise.language", value);
    } catch {
      /* Current-page selection still works. */
    }
  }
  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: (key) => (language === "th" ? th : en)[key] ?? en[key],
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
