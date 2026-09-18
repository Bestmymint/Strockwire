import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  E2E_BRANCH_ID,
  E2E_ORGANIZATION_ID,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from "./catalog-fixtures.ts";

const posPath = `/app/pos?organizationId=${E2E_ORGANIZATION_ID}&branchId=${E2E_BRANCH_ID}`;
const salesPath = `/app/sales?organizationId=${E2E_ORGANIZATION_ID}&branchId=${E2E_BRANCH_ID}`;

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_OWNER_EMAIL);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("owner reviews an immutable sale and opens its printable browser receipt", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(posPath);
  await page.getByLabel("Sales VAT status").selectOption("NOT_REGISTERED");
  await page.getByRole("button", { name: "Save VAT profile" }).click();
  await page.getByLabel("Search products").fill("POS-E2E-03");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add POS E2E coffee" }).click();
  await page.getByLabel("Amount tendered (THB)").fill("50.00");
  await page.getByRole("button", { name: "Complete sale" }).click();
  const reference = (await page.getByText(/^SALE-/).textContent())?.split(
    " · ",
  )[0];
  expect(reference).not.toBeNull();

  await page.goto(salesPath);
  await expect(
    page.getByRole("heading", { name: "Sales history" }),
  ).toBeVisible();
  await expect(page.getByText(reference!)).toBeVisible();
  await page.getByRole("button", { name: "View detail" }).first().click();
  const receipt = page.getByLabel("Printable receipt");
  await expect(receipt.getByText("POS E2E coffee")).toBeVisible();
  await expect(receipt.getByText(/Tendered THB 50.00/)).toBeVisible();
  await expect(receipt).not.toContainText(/COGS|cost/i);
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printed = "true";
    };
  });
  await page.getByRole("button", { name: "Print receipt" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-printed", "true");
});

test("sales history is accessible and fits a narrow tablet", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(salesPath);
  await expect(
    page.getByRole("heading", { name: "Sales history" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ height: 844, width: 768 });
  await expect(
    page
      .locator("main")
      .evaluate((main) => main.scrollWidth <= main.clientWidth),
  ).resolves.toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
