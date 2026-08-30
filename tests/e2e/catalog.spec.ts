import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  E2E_BRANCH_ID,
  E2E_CASHIER_EMAIL,
  E2E_ORGANIZATION_ID,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from "./catalog-fixtures.ts";

const catalogPath = `/app/catalog?organizationId=${E2E_ORGANIZATION_ID}&branchId=${E2E_BRANCH_ID}`;

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("owner manages the catalog through the same-origin application path", async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(catalogPath);
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();

  await page.getByRole("tab", { name: "Categories" }).click();
  await page.getByLabel("Category name").first().fill("Drinks");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page.getByRole("heading", { name: "Drinks" })).toBeVisible();

  await page.getByRole("tab", { name: "Products" }).click();
  await page.getByLabel("Product name").first().fill("Green tea");
  await page.getByLabel("SKU").first().fill("TEA-E2E-01");
  await page.getByLabel("Base price").first().fill("12.3400");
  await page
    .getByLabel("Category (optional)")
    .first()
    .selectOption({ label: "Drinks" });
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "Green tea" })).toBeVisible();
  await expect(page.getByText("TEA-E2E-01 · 12.3400 · EA")).toBeVisible();

  await page.getByLabel("Search catalog").fill("TEA-E2E");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "Green tea" })).toBeVisible();

  const productForm = page.getByRole("form", {
    name: "Edit product Green tea",
  });
  await productForm.getByLabel("Product name").fill("Green tea updated");
  await productForm.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Green tea updated" }),
  ).toBeVisible();

  const updatedProductForm = page.getByRole("form", {
    name: "Edit product Green tea updated",
  });
  await updatedProductForm.getByRole("button", { name: "Deactivate" }).click();
  await page.getByLabel("Include inactive catalog records").check();
  await expect(
    page.getByRole("heading", { name: "Green tea updated" }),
  ).toBeVisible();
  await expect(updatedProductForm.getByText("Inactive")).toBeVisible();
  await updatedProductForm.getByRole("button", { name: "Reactivate" }).click();
  await expect(updatedProductForm.getByText("Active")).toBeVisible();
});

test("cashier receives only the accepted catalog view UX", async ({ page }) => {
  await signIn(page, E2E_CASHIER_EMAIL);
  await page.goto(catalogPath);

  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create product" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  await expect(page.getByLabel("Include inactive catalog records")).toHaveCount(
    0,
  );
});

test("catalog views have no automated axe violations on desktop and mobile", async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(catalogPath);
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("tab", { name: "Categories" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByRole("tab", { name: "Products" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
