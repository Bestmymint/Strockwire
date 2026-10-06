"use client";

import { Check, Globe, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLanguage } from "@/providers/language-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PreferenceControls() {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label={t("theme")} />
          }
        >
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(["light", "dark"] as const).map((value) => (
            <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
              {value === "light" ? <Sun /> : <Moon />}
              {t(value)}
              {theme === value && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" aria-label={t("language")} />}
        >
          <Globe />
          <span>{language === "th" ? "ไทย" : "EN"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setLanguage("en")}>
            English{language === "en" && <Check className="ml-auto" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLanguage("th")}>
            ไทย{language === "th" && <Check className="ml-auto" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
