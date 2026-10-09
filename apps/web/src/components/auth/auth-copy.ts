import { AuthApiError } from "@/api-client";
import type { TranslationKey } from "@/i18n/en";

export function verificationErrorMessage(
  error: unknown,
  t: (key: TranslationKey) => string,
): string {
  if (!(error instanceof AuthApiError)) return t("authRequestError");
  if (error.kind === "rate_limited") {
    return error.retryAfterSeconds === null
      ? t("authRateLimitedGeneric")
      : t("authRateLimited")
          .replace("{seconds}", String(error.retryAfterSeconds))
          .replace("{plural}", error.retryAfterSeconds === 1 ? "" : "s");
  }
  switch (error.kind) {
    case "invalid_credentials":
      return t("authInvalidCredentials");
    case "invalid_token":
      return t("authInvalidLink");
    case "invalid_verification_code":
      return t("authInvalidCode");
    case "validation":
      return t("authCheckInformation");
    default:
      return t("authRequestError");
  }
}
