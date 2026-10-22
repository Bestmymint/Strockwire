"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/api-client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLanguage } from "@/providers/language-provider";
import { notifySessionChange } from "@/session-lifecycle";

export function LogoutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [error, setError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function handleLogout() {
    if (isSubmitting) return;
    setError(false);
    setIsSubmitting(true);
    try {
      await logout();
      notifySessionChange(queryClient);
      router.replace("/login");
    } catch {
      setError(true);
    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive" aria-live="assertive">
          <AlertDescription>{t("requestError")}</AlertDescription>
        </Alert>
      )}
      <Button
        className="w-full justify-start"
        variant="outline"
        disabled={isSubmitting}
        onClick={handleLogout}
        type="button"
      >
        <LogOut aria-hidden="true" />
        {isSubmitting ? t("loggingOut") : t("logout")}
      </Button>
    </div>
  );
}
