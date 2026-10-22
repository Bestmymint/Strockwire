import { describe, expect, it } from "vitest";
import { isGuestRoute, routeAccessPolicy } from "./route-access-policy";

describe("route access policy", () => {
  it.each([
    ["/", "public-marketing", false],
    ["/pricing", "public-marketing", false],
    ["/login", "guest-auth", true],
    ["/register", "guest-auth", true],
    ["/verification-resend", "guest-recovery", true],
    ["/forgot-password", "guest-recovery", true],
    ["/reset-password", "guest-recovery", true],
    ["/verify-email", "guest-recovery", true],
    ["/app", "protected-application", false],
    ["/app/catalog", "protected-application", false],
    ["/app/sales/receipt", "protected-application", false],
    ["/onboarding", "onboarding", false],
    ["/accept-invitation", "invitation", false],
    ["/application", "unknown", false],
    ["/register/unknown", "unknown", false],
    ["/missing", "unknown", false],
  ] as const)("classifies %s without overblocking", (path, policy, guest) => {
    expect(routeAccessPolicy(path)).toBe(policy);
    expect(isGuestRoute(routeAccessPolicy(path))).toBe(guest);
  });
});
