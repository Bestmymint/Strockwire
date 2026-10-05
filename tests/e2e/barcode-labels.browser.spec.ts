import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const catalogPath = `/app/catalog?organizationId=${organizationId}&branchId=${branchId}`;
const initialProduct = {
  id: "40000000-0000-4000-8000-000000000001",
  organizationId,
  name: "Green tea",
  sku: "TEA-01",
  barcode: "0012345678905",
  basePrice: "12.3400",
  categoryId: null,
  description: null,
  status: "ACTIVE",
  unit: "EA",
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
};

async function stubCatalog(
  page: import("@playwright/test").Page,
  role = "OWNER",
  barcode: string | null = initialProduct.barcode,
) {
  // Real Next.js UI; authentication/persistence are deliberately stubbed.
  let product = { ...initialProduct, barcode };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/me/access-context") {
      await route.fulfill({
        json: {
          data: {
            firstOrganizationOnboarding: { eligible: false },
            organizations: [
              {
                id: organizationId,
                name: "Label test shop",
                role,
                branches: [{ id: branchId, name: "Main", code: "MAIN" }],
              },
            ],
            user: {
              id: "30000000-0000-4000-8000-000000000001",
              displayName: "Owner",
              email: "owner@example.test",
            },
          },
        },
      });
    } else if (path.endsWith("/categories")) {
      await route.fulfill({
        json: { data: { categories: [] }, meta: { nextCursor: null } },
      });
    } else if (
      path.endsWith(`/products/${initialProduct.id}`) &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON();
      product = {
        ...product,
        barcode: body.barcode === "" ? null : body.barcode,
        updatedAt: "2026-10-05T00:01:00.000Z",
      };
      await route.fulfill({ json: { data: { product } } });
    } else if (path.endsWith("/products")) {
      await route.fulfill({
        json: { data: { products: [product] }, meta: { nextCursor: null } },
      });
    } else {
      await route.fulfill({
        status: 404,
        json: { error: { code: "NOT_FOUND" } },
      });
    }
  });
}

for (const width of [375, 430, 768, 1024, 1280, 1440]) {
  test(`catalog and label preview fit and are accessible at ${width}px (stub API)`, async ({
    page,
  }, testInfo) => {
    await stubCatalog(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(catalogPath);
    const editor = page.getByRole("form", { name: "Edit product Green tea" });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Barcode (optional)")).toHaveValue(
      initialProduct.barcode,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`catalog-${width}.png`),
      fullPage: true,
    });

    // Save through the existing Product API before opening the label preview.
    await editor.getByLabel("Barcode (optional)").fill("0001234567890");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(
      editor.getByRole("button", { name: "Save changes" }),
    ).toBeEnabled();
    await editor
      .getByRole("button", { name: "Preview barcode labels" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Barcode label preview" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("img", { name: "Code 128 barcode 0001234567890" }),
    ).toBeVisible();
    await dialog.getByLabel("Label quantity").fill("3");
    await expect(dialog.getByRole("article")).toHaveCount(3);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`labels-${width}.png`) });

    await page.evaluate(() => {
      window.print = () => {
        document.body.dataset.labelPrintCalls = "1";
      };
    });
    await dialog.getByRole("button", { name: "Print labels" }).click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-label-print-calls",
      "1",
    );
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Catalog", exact: true }),
    ).toBeHidden();
    await expect(
      dialog.getByRole("button", { name: "Print labels" }),
    ).toBeHidden();
    await expect(dialog.getByRole("article")).toHaveCount(3);
    const svg = dialog.locator("svg").first();
    const symbolWidth = await svg.evaluate((element) => ({
      actual: element.getBoundingClientRect().width,
      mm: Number(element.getAttribute("width")!.replace("mm", "")),
    }));
    expect(symbolWidth.actual).toBeCloseTo((symbolWidth.mm * 96) / 25.4, 1);
    await page.emulateMedia({ media: "screen" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: "Preview barcode labels" }),
    ).toBeFocused();
    await expect(page).toHaveURL(catalogPath);
  });
}

test("missing/Unicode barcodes have honest print states; cashier cannot edit (stub API)", async ({
  page,
}) => {
  await stubCatalog(page, "CASHIER", null);
  await page.goto(catalogPath);
  await expect(
    page.getByRole("button", { name: "Preview barcode labels" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Barcode (optional)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );
  await page.unroute("**/api/v1/**");
  await stubCatalog(page, "CASHIER", "สินค้า");
  await page.reload();
  await page.getByRole("button", { name: "Preview barcode labels" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "saved barcode is unchanged",
  );
  await expect(
    page.getByRole("button", { name: "Print labels" }),
  ).toBeDisabled();
});

test("headless print produces repeated vector labels across page boundaries (stub API)", async ({
  page,
}, testInfo) => {
  await stubCatalog(page);
  await page.goto(catalogPath);
  await page.getByRole("button", { name: "Preview barcode labels" }).click();
  for (const quantity of [1, 5, 6, 10]) {
    await page.getByLabel("Label quantity").fill(String(quantity));
    await expect(page.getByRole("article")).toHaveCount(quantity);
    // PDF rendering supports layout review, not native print-preview verification.
    await page.pdf({
      path: testInfo.outputPath(`labels-${quantity}.pdf`),
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
  }
});
