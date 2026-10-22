export type RouteAccessPolicy =
  | "public-marketing"
  | "guest-auth"
  | "guest-recovery"
  | "protected-application"
  | "onboarding"
  | "invitation"
  | "unknown";

// Layout UX only. Express remains the authentication/authorization boundary.
export function routeAccessPolicy(pathname: string): RouteAccessPolicy {
  if (pathname === "/" || pathname === "/pricing") return "public-marketing";
  if (pathname === "/login" || pathname === "/register") return "guest-auth";
  if (
    pathname === "/verification-resend" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email"
  )
    return "guest-recovery";
  if (pathname === "/app" || pathname.startsWith("/app/"))
    return "protected-application";
  if (pathname === "/onboarding") return "onboarding";
  if (pathname === "/accept-invitation") return "invitation";
  return "unknown";
}

export function isGuestRoute(policy: RouteAccessPolicy): boolean {
  return policy === "guest-auth" || policy === "guest-recovery";
}
