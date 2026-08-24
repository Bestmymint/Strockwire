import { isSessionToken } from "./session-token.ts";

export const SESSION_COOKIE_NAME = "stockwise_session";

export function serializeSessionCookie(
  rawToken: string,
  secure: boolean,
): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${rawToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function serializeClearedSessionCookie(secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function readSessionCookie(
  cookieHeader: string | undefined,
): string | null {
  if (cookieHeader === undefined) {
    return null;
  }

  const matchingValues: string[] = [];

  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const name = segment.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }

    const encodedValue = segment.slice(separator + 1).trim();
    try {
      matchingValues.push(decodeURIComponent(encodedValue));
    } catch {
      return null;
    }
  }

  if (matchingValues.length !== 1 || !isSessionToken(matchingValues[0] ?? "")) {
    return null;
  }

  return matchingValues[0] ?? null;
}
