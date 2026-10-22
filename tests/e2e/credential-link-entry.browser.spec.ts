import { expect, test } from "@playwright/test";

const secureToken = "A".repeat(43);
const organizationId = "10000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";

test("reset token is never serialized in Next response and requires explicit POST", async ({
  page,
  context,
}) => {
  let resetPosts = 0;
  await context.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/me/access-context") {
      return route.fulfill({
        status: 401,
        json: { error: { code: "AUTHENTICATION_REQUIRED" } },
      });
    }
    if (pathname === "/api/v1/auth/reset-password") {
      resetPosts += 1;
      const input = route.request().postDataJSON();
      expect(input.token).toBe(secureToken);
      expect(input.newPassword).toBe("sufficiently-long-synthetic-password");
      return route.fulfill({
        status: 200,
        json: { data: { status: "password_reset" } },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "DEPENDENCY_UNAVAILABLE" } },
    });
  });

  const response = await page.goto(`/reset-password?token=${secureToken}`);
  expect(response?.status()).toBe(200);
  const content = await response!.text();
  expect(content).not.toContain(secureToken);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(
    page.getByRole("button", { name: "Reset password" }),
  ).toBeVisible();
  expect(resetPosts).toBe(0);

  await page
    .getByLabel("New password")
    .fill("sufficiently-long-synthetic-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(
    page.getByText(
      "Your password has been reset. Sign in with your new password.",
    ),
  ).toBeVisible();
  expect(resetPosts).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("stockwise.resetToken")),
  ).toBeNull();
});

test("invitation token remains in a one-use browser handoff and is posted only on click", async ({
  page,
  context,
}) => {
  let accepts = 0;
  let accepted = false;
  await context.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/me/access-context")
      return route.fulfill({
        status: 200,
        json: {
          data: {
            firstOrganizationOnboarding: { eligible: false },
            organizations: [
              {
                id: "40000000-0000-4000-8000-000000000001",
                name: "Old organization",
                role: "OWNER",
                branches: [],
              },
              ...(accepted
                ? [
                    {
                      id: organizationId,
                      name: "Synthetic organization",
                      role: "ADMIN",
                      branches: [],
                    },
                  ]
                : []),
            ],
            user: {
              id: userId,
              email: "synthetic@example.test",
              displayName: "Synthetic user",
            },
          },
        },
      });
    if (pathname === "/api/v1/invitations/accept") {
      accepts += 1;
      accepted = true;
      expect(route.request().postDataJSON().token).toBe(secureToken);
      return route.fulfill({
        status: 200,
        json: {
          data: {
            membership: {
              branchAssignments: [],
              createdAt: "2026-10-12T00:00:00.000Z",
              id: "20000000-0000-4000-8000-000000000001",
              organization: {
                id: organizationId,
                name: "Synthetic organization",
              },
              role: "ADMIN",
              status: "ACTIVE",
              updatedAt: "2026-10-12T00:00:00.000Z",
              user: {
                id: userId,
                displayName: "Synthetic user",
                email: "synthetic@example.test",
              },
            },
            replayed: false,
          },
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "DEPENDENCY_UNAVAILABLE" } },
    });
  });

  const response = await page.goto(`/accept-invitation?token=${secureToken}`);
  expect(response?.status()).toBe(200);
  expect(await response!.text()).not.toContain(secureToken);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL(/\/accept-invitation$/);
  await expect(
    page.getByRole("button", { name: "Accept invitation" }),
  ).toBeVisible();
  expect(accepts).toBe(0);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app\\?organizationId=${organizationId}`),
  );
  expect(accepts).toBe(1);
  // The accepted membership must be reflected by a FRESH access-context query,
  // not merely a URL change while the old organization remains in cache.
  await expect(
    page.getByRole("heading", { name: "Synthetic organization", exact: true }),
  ).toBeVisible();
});

test("invalid and duplicate token query params are scrubbed before hydration without POST", async ({
  page,
  context,
}) => {
  let mutations = 0;
  await context.route("**/api/v1/**", (route) => {
    if (route.request().method() !== "GET") mutations += 1;
    return route.fulfill({
      status: 401,
      json: { error: { code: "AUTHENTICATION_REQUIRED" } },
    });
  });
  for (const pathname of ["/reset-password", "/accept-invitation"]) {
    for (const query of [
      "token=invalid",
      `token=${secureToken}&token=${secureToken}`,
    ]) {
      const response = await page.goto(`${pathname}?${query}`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${pathname}$`));
      expect(await response!.text()).not.toContain(secureToken);
      expect(await page.locator("body").innerText()).not.toContain(secureToken);
    }
  }
  expect(mutations).toBe(0);
});

test("anonymous invitation 401 offers sign-in guidance without a global logout redirect", async ({
  page,
  context,
}) => {
  let attempts = 0;
  await context.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/me/access-context")
      return route.fulfill({
        status: 401,
        json: { error: { code: "AUTHENTICATION_REQUIRED" } },
      });
    if (pathname === "/api/v1/invitations/accept") {
      attempts += 1;
      return route.fulfill({
        status: 401,
        json: { error: { code: "AUTHENTICATION_REQUIRED" } },
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: { code: "DEPENDENCY_UNAVAILABLE" } },
    });
  });
  await page.goto(`/accept-invitation?token=${secureToken}`);
  await expect(page).toHaveURL(/\/accept-invitation$/);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "reopen this invitation link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/accept-invitation$/);
  expect(attempts).toBe(1);
});
