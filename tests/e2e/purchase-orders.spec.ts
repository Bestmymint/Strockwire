import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  E2E_BRANCH_ID,
  E2E_CASHIER_EMAIL,
  E2E_INVENTORY_PRODUCT_ID,
  E2E_ORGANIZATION_ID,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
  E2E_PURCHASE_PRODUCT_ID,
} from "./catalog-fixtures.ts";

const purchaseOrderPath = `/app/purchase-orders?organizationId=${E2E_ORGANIZATION_ID}&branchId=${E2E_BRANCH_ID}`;

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createDraft(page: import("@playwright/test").Page) {
  const form = page.getByRole("form", { name: "Create draft purchase order" });
  await form
    .getByLabel("Supplier")
    .selectOption({ label: "Purchase order E2E supplier" });
  await form
    .getByLabel("Product line 1 product")
    .selectOption(E2E_INVENTORY_PRODUCT_ID);
  await form.getByLabel("Product line 1 quantity (EA)").fill("2");
  await form
    .getByLabel("Product line 1 expected unit cost (THB)")
    .fill("12.5000");
  await form.getByRole("button", { name: "Add product line" }).click();
  await form
    .getByLabel("Product line 2 product")
    .selectOption(E2E_PURCHASE_PRODUCT_ID);
  await form.getByLabel("Product line 2 quantity (KG)").fill("0.5");
  await form.getByLabel("Product line 2 expected unit cost (THB)").fill("8");
  await form
    .getByRole("button", { name: "Create draft purchase order" })
    .click();
  await expect(
    page.getByRole("form", { name: "Save draft changes" }),
  ).toBeVisible();
}

test("owner creates, edits, orders, and cancels purchase orders", async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(purchaseOrderPath);
  await expect(
    page.getByRole("heading", { name: "Purchase orders" }),
  ).toBeVisible();

  await createDraft(page);
  const edit = page.getByRole("form", { name: "Save draft changes" });
  await edit.getByLabel("Expected date (optional)").fill("2026-09-15");
  await edit.getByRole("button", { name: "Save draft changes" }).click();
  await page.getByRole("button", { name: "Order purchase order" }).click();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(page.getByText("Frozen product lines")).toBeVisible();
  await expect(page.getByRole("button", { name: /receive/i })).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Save draft changes" }),
  ).toHaveCount(0);

  await createDraft(page);
  await page.getByRole("button", { name: "Cancel purchase order" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(
    page.getByText(/Commercial fields are read-only in Cancelled status/),
  ).toBeVisible();
});

test("cashier cannot manage purchase orders", async ({ page }) => {
  await signIn(page, E2E_CASHIER_EMAIL);
  await page.goto(purchaseOrderPath);
  await expect(
    page.getByText("You do not have permission to manage purchase orders."),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Create draft purchase order" }),
  ).toHaveCount(0);
});

test("purchase-order UI has no automated axe violations on desktop and mobile", async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(purchaseOrderPath);
  await expect(
    page.getByRole("heading", { name: "Purchase orders" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ height: 844, width: 390 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
