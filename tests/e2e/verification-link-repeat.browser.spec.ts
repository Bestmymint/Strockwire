import { expect, test } from "@playwright/test";

const usedLink = "q".repeat(43);
const user = {
  id: "30000000-0000-4000-8000-000000000001",
  email: "verified@example.test",
  displayName: "Verified user",
};

for (const signedIn of [false, true]) {
  test(`previously used email link gives explicit status without sign-in or auto-POST (session ${signedIn ? "present" : "absent"})`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("stockwise.language", "en"),
    );
    const calls: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      calls.push(`${route.request().method()} ${path}`);
      if (path === "/api/v1/me/access-context") {
        return route.fulfill(
          signedIn
            ? {
                json: {
                  data: {
                    firstOrganizationOnboarding: { eligible: false },
                    organizations: [],
                    user,
                  },
                },
              }
            : {
                status: 401,
                json: { error: { code: "AUTHENTICATION_REQUIRED" } },
              },
        );
      }
      if (path === "/api/v1/auth/verify-email") {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON()).toEqual({ token: usedLink });
        return route.fulfill({
          json: { data: { status: "already_verified" } },
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const entry = await page.goto(`/verify-email?token=${usedLink}`);
    expect(entry?.status()).toBe(200);
    expect(await entry!.text()).not.toContain(usedLink);
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(
      page.getByRole("button", { name: "Check verification link" }),
    ).toBeVisible();
    expect(calls.filter((call) => call.includes("/verify-email"))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await page.getByRole("button", { name: "Check verification link" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "already verified" }),
    ).toBeVisible();
    expect(calls.filter((call) => call.includes("/auth/verify-email"))).toEqual(
      ["POST /api/v1/auth/verify-email"],
    );
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }).first(),
    ).toBeVisible();
  });
}

test("expired or unrecognized verification link never claims the account was verified", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("stockwise.language", "en"),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/me/access-context")
      return route.fulfill({
        status: 401,
        json: { error: { code: "AUTHENTICATION_REQUIRED" } },
      });
    if (path === "/api/v1/auth/verify-email")
      return route.fulfill({
        status: 400,
        json: { error: { code: "INVALID_TOKEN" } },
      });
    throw new Error(`Unexpected API call: ${path}`);
  });
  await page.goto(`/verify-email?token=${usedLink}`);
  await page.getByRole("button", { name: "Check verification link" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid or expired" }),
  ).toBeVisible();
  await expect(page.getByText(/already verified/)).toHaveCount(0);
});
