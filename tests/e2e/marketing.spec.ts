import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [375, 430, 768, 1024, 1280, 1440]) {
  for (const path of ["/", "/pricing"]) {
    test(`${path} is accessible and fits at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const apiRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("complementary")).toHaveCount(0);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(await page.title()).toContain("StockWise");
      expect(
        await page.locator('meta[name="description"]').getAttribute("content"),
      ).toBeTruthy();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (width < 701) {
        await expect(
          page.getByRole("navigation", { name: "Public navigation" }),
        ).toBeHidden();
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await expect(
          page.getByRole("navigation", { name: "Public navigation" }),
        ).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.getByRole("button", { name: "Close menu" }).click();
      }
      expect(apiRequests).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(
          `public-${path === "/" ? "home" : "pricing"}-${width}-top.png`,
        ),
      });
      await page.screenshot({
        path: testInfo.outputPath(
          `public-${path === "/" ? "home" : "pricing"}-${width}.png`,
        ),
        fullPage: true,
      });
    });
  }
}

test("public navigation reaches features, pricing, and the actual auth forms", async ({
  page,
}) => {
  // Only session observation is stubbed; the public pages and auth forms are real Next.js routes.
  await page.route("**/api/v1/me/access-context", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "AUTHENTICATION_REQUIRED" } },
    }),
  );
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Public navigation" });
  await nav.getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/\/#features$/);
  await expect(
    page.getByRole("heading", { name: /Less guesswork/ }),
  ).toBeInViewport();
  await nav.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL("/pricing");
  for (const name of ["Starter", "Growth", "Business"])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await page
    .getByRole("link", { name: "Create an account", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL("/register");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create account" }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL("/login");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Forgot password?" }),
  ).toHaveAttribute("href", "/forgot-password");
});

test("mobile menu supports keyboard use, Escape, and closes after a feature link", async ({
  page,
}) => {
  await page.route("**/api/v1/me/access-context", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "AUTHENTICATION_REQUIRED" } },
    }),
  );
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  const menu = page.getByRole("button", { name: /^(Menu|Close menu)$/ });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  const features = page
    .getByRole("navigation", { name: "Public navigation" })
    .getByRole("link", { name: "Features" });
  await expect(features).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await features.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/\/#features$/);
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL("/register");
  await expect(
    page.getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
});

test("public routes separate from the desktop/mobile app shell and preserve logout navigation", async ({
  page,
}) => {
  let signedIn = true;
  const organizationId = "10000000-0000-4000-8000-000000000001";
  const branchId = "20000000-0000-4000-8000-000000000001";
  // This checks browser shell transitions; it does not claim live authentication verification.
  await page.route("**/api/v1/me/access-context", (route) =>
    route.fulfill(
      signedIn
        ? {
            json: {
              data: {
                firstOrganizationOnboarding: { eligible: false },
                organizations: [
                  {
                    id: organizationId,
                    name: "Test shop",
                    role: "OWNER",
                    branches: [
                      { id: branchId, name: "Main store", code: "MAIN" },
                    ],
                  },
                ],
                user: {
                  id: "30000000-0000-4000-8000-000000000001",
                  email: "owner@example.test",
                  displayName: "Owner",
                },
              },
            },
          }
        : { status: 401, json: { error: { code: "AUTHENTICATION_REQUIRED" } } },
    ),
  );
  await page.route("**/api/v1/auth/logout", (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  await expect(page).toHaveURL(
    `/app?organizationId=${organizationId}&branchId=${branchId}`,
  );
  const appNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    appNav.getByRole("link", { name: "Inventory", exact: true }),
  ).toHaveAttribute(
    "href",
    `/app/inventory?organizationId=${organizationId}&branchId=${branchId}`,
  );
  for (const path of ["/", "/pricing"]) {
    await page.goto(path);
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Public navigation" }),
    ).toBeVisible();
  }
  await page.goto("/login");
  await expect(appNav).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(appNav).toBeHidden();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(appNav).toBeVisible();
  await appNav.getByRole("link", { name: "Home", exact: true }).click();
  await expect(appNav).toBeHidden();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});
