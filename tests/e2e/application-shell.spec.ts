import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  E2E_BRANCH_ID,
  E2E_CASHIER_EMAIL,
  E2E_ORGANIZATION_ID,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from "./catalog-fixtures.ts";

const homePath = `/app?organizationId=${E2E_ORGANIZATION_ID}&branchId=${E2E_BRANCH_ID}`;

async function signIn(page: Page, email = E2E_OWNER_EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
  if (email === E2E_OWNER_EMAIL) {
    await page
      .getByRole("button", { name: "Catalog E2E Store", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Catalog E2E Store", exact: true }),
  ).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("desktop sidebar preserves scoped navigation, active state, logo and logout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const sidebar = page.getByRole("complementary", {
    name: "Application sidebar",
  });
  const main = page.getByRole("main");
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await expect(
    sidebar.getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("href", homePath);
  await expect(
    sidebar.getByRole("link", { name: "StockWise" }),
  ).toHaveAttribute("href", homePath);
  await expect(main.getByRole("link")).toHaveCount(0);
  const sidebarBox = (await sidebar.boundingBox())!;
  const mainBox = (await main.boundingBox())!;
  const logoutBox = (await sidebar
    .getByRole("button", { name: "Log out" })
    .boundingBox())!;
  expect(sidebarBox.x).toBe(0);
  expect(sidebarBox.height).toBe(900);
  expect(mainBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width);
  expect(logoutBox.y + logoutBox.height).toBeGreaterThan(850);
  await expectNoOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("desktop-home.png"),
    fullPage: true,
  });

  await sidebar.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Catalog", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Catalog", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    sidebar.getByRole("link", { name: "Home", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await expectNoOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("desktop-catalog.png"),
    fullPage: true,
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect((await sidebar.boundingBox())!.y).toBe(0);
  await sidebar.getByRole("link", { name: "StockWise" }).click();
  await expect(page).toHaveURL(homePath);

  const logoutResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/auth/logout") &&
      response.request().method() === "POST",
  );
  await sidebar.getByRole("button", { name: "Log out" }).focus();
  await page.keyboard.press("Enter");
  expect((await logoutResponse).status()).toBe(204);
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "stockwise_session",
    ),
  ).toBe(false);
  expect((await page.request.get("/api/v1/me/access-context")).status()).toBe(
    401,
  );
  await page.screenshot({
    path: testInfo.outputPath("signed-out-login.png"),
    fullPage: true,
  });
});

test("small-screen menu supports keyboard navigation and scoped logo links", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const sidebar = page.getByRole("complementary", {
    name: "Application sidebar",
  });
  await expect(sidebar).toBeHidden();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close menu" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("button", { name: "Log out" })).toBeVisible();
  await expectNoOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("mobile-menu.png"),
    fullPage: true,
  });

  await sidebar
    .getByRole("link", { name: "Catalog", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Catalog", exact: true }),
  ).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expectNoOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("mobile-catalog.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "StockWise" }).click();
  await expect(page).toHaveURL(homePath);
  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(menu).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expectNoOverflow(page);
});

test("cashier receives access-aware destinations while API authorization remains enforced", async ({
  page,
}) => {
  await signIn(page, E2E_CASHIER_EMAIL);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "Point of sale" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sales history" })).toBeVisible();
  for (const name of [
    "Manage branches",
    "Manage members",
    "Analytics",
    "Suppliers",
    "Purchase orders",
  ]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  const forbidden = await page.request.get(
    `/api/v1/organizations/${E2E_ORGANIZATION_ID}/members`,
  );
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
});

test("signed-out public and app surfaces do not expose authenticated navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Know your stock/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Public navigation" })
      .getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("public-home.png"),
    fullPage: true,
  });
  await page.goto("/app");
  // The existing workspace observer retries access-context reads before settling.
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Sign in" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
});

test("authenticated marketing stays public and login returns to Home", async ({
  page,
}) => {
  await signIn(page);
  for (const path of ["/", "/pricing"]) {
    await page.goto(path);
    await expect(
      page.getByRole("navigation", { name: "Public navigation" }),
    ).toBeVisible();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("complementary")).toHaveCount(0);
  }
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Choose an organization" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/app");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
});
