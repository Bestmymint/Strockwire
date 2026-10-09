import { NextResponse, type NextRequest } from "next/server";

import { verificationLinkEntryHtml } from "./verification-link-entry";

export function proxy(request: NextRequest) {
  if (request.nextUrl.searchParams.has("token")) {
    return new NextResponse(verificationLinkEntryHtml, {
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

export const config = { matcher: "/verify-email" };
