import { AuthApiError, type AuthApiErrorKind } from "@/api-client";

export function passwordValidationMessage(password: string): string | null {
  const codePointLength = [...password].length;

  if (codePointLength < 15 || codePointLength > 128) {
    return "Password must contain between 15 and 128 Unicode code points.";
  }

  return null;
}

export function hasEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function waitMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) {
    return "Please wait before trying again.";
  }

  const unit = retryAfterSeconds === 1 ? "second" : "seconds";
  return `Please wait ${retryAfterSeconds} ${unit} before trying again.`;
}

export function authErrorMessage(
  error: unknown,
  overrides: Partial<Record<AuthApiErrorKind, string>> = {},
): string {
  if (!(error instanceof AuthApiError)) {
    return "We could not complete that request. Please try again.";
  }

  if (error.kind === "rate_limited") {
    return waitMessage(error.retryAfterSeconds);
  }

  return (
    overrides[error.kind] ??
    (error.kind === "unavailable"
      ? "We could not complete that request. Please try again."
      : "Please check the information and try again.")
  );
}
