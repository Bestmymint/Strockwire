import { NextResponse, type NextRequest } from "next/server";

import { verificationLinkEntryHtml } from "./verification-link-entry";
import {
  credentialLinkEntryHtml,
  type CredentialLinkRoute,
} from "./credential-link-entry";

export function proxy(request: NextRequest) {
  if (request.nextUrl.searchParams.has("token")) {
    const pathname = request.nextUrl.pathname;
    const html =
      pathname === "/verify-email"
        ? verificationLinkEntryHtml
        : credentialLinkEntryHtml(pathname as CredentialLinkRoute);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/verify-email", "/reset-password", "/accept-invitation"],
};
