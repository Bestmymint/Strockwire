import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const posPath = `/app/pos?organizationId=${organizationId}&branchId=${branchId}`;
const product = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "Coffee",
  sku: "COFFEE",
  barcode: "00AbC",
  unit: "EA",
  basePrice: "12.3456",
  available: true,
};

async function stubPos(page: Page) {
  const scans: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/access-context")) {
      await route.fulfill({
        json: {
          data: {
            firstOrganizationOnboarding: { eligible: false },
            organizations: [
              {
                id: organizationId,
                name: "Scanner test shop",
                role: "OWNER",
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
    } else if (url.pathname.endsWith("/sales-vat-profile")) {
      await route.fulfill({
        json: {
          data: {
            salesVatProfile: {
              salesVatStatus: "NOT_REGISTERED",
              salesVatRate: null,
              updatedAt: "2026-10-05T00:00:00.000Z",
            },
          },
        },
      });
    } else if (url.pathname.endsWith("/pos/products")) {
      const barcode = url.searchParams.get("barcode");
      if (barcode) scans.push(barcode);
      if (barcode === "server-error") {
        await route.fulfill({
          status: 503,
          json: { error: { code: "DEPENDENCY_UNAVAILABLE" } },
        });
      } else {
        await route.fulfill({
          json: {
            data: {
              products:
                barcode === "missing"
                  ? []
                  : [
                      {
                        ...product,
                        barcode: barcode ?? product.barcode,
                        available: barcode !== "no-stock",
                      },
                    ],
            },
            meta: { nextCursor: null },
          },
        });
      }
    } else
      await route.fulfill({
        status: 404,
        json: { error: { code: "NOT_FOUND" } },
      });
  });
  return scans;
}

async function scan(page: Page, value: string) {
  const input = page.getByLabel("Scan or enter barcode");
  await input.fill(value);
  await input.press("Enter");
}

test("keyboard-emulated scanner preserves values and repeated cart semantics", async ({
  page,
}) => {
  const scans = await stubPos(page);
  await page.goto(posPath);
  const input = page.getByLabel("Scan or enter barcode");
  await expect(input).toBeFocused();
  await page.keyboard.type("00AbC");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
  await page.keyboard.type("00AbC");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("2");
  expect(scans).toEqual(["00AbC", "00AbC"]);
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await page.getByLabel("Search products").fill("human typing");
  await page.getByLabel("Amount tendered (THB)").fill("100.00");
  expect(scans).toHaveLength(2);
});

test("rapid scans wait in order and checkout waits for the queue", async ({
  page,
}) => {
  const scans = await stubPos(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/pos/products?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("barcode") === "held" &&
      !held
    ) {
      held = true;
      await gate;
    }
    await route.fallback();
  });
  await page.goto(posPath);
  await scan(page, "held");
  await scan(page, "other");
  await scan(page, "held");
  await expect(page.getByText(/3 pending/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete sale" }),
  ).toBeDisabled();
  expect(scans).toEqual([]);
  release();
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("3");
  expect(scans).toEqual(["held", "other", "held"]);
  await expect(
    page.getByRole("button", { name: "Complete sale" }),
  ).toBeEnabled();
});

test("unknown/unavailable/network errors preserve cart and allow another scan", async ({
  page,
}) => {
  await stubPos(page);
  await page.goto(posPath);
  await scan(page, "00AbC");
  await scan(page, "missing");
  await expect(
    page.getByText("No product found for barcode missing."),
  ).toBeVisible();
  await scan(page, "no-stock");
  await expect(page.getByText(/no-stock.*unavailable/)).toBeVisible();
  await scan(page, "server-error");
  await expect(
    page.getByText(/Could not look up barcode server-error/),
  ).toBeVisible();
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
  await scan(page, "00AbC");
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("2");
});

for (const mode of ["unsupported", "denied", "insecure"] as const) {
  test(`camera ${mode} fallback keeps POS usable and restores focus`, async ({
    page,
  }) => {
    await page.addInitScript((scenario) => {
      if (scenario === "unsupported")
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: undefined,
        });
      else if (scenario === "insecure")
        Object.defineProperty(window, "isSecureContext", {
          configurable: true,
          value: false,
        });
      else
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {
            getUserMedia: async () => {
              throw new DOMException("fixture", "NotAllowedError");
            },
          },
        });
    }, mode);
    await stubPos(page);
    await page.goto(posPath);
    await page.getByRole("button", { name: "Scan with camera" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Scan barcode with camera",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText(
      mode === "unsupported"
        ? "unsupported"
        : mode === "denied"
          ? "permission was denied"
          : "requires HTTPS",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel("Scan or enter barcode")).toBeFocused();
    await scan(page, "00AbC");
    await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
  });
}

async function fakeCamera(page: Page, native: boolean, value = "00AbC") {
  await page.addInitScript(
    ({ native, value }) => {
      Object.defineProperty(window, "BarcodeDetector", {
        configurable: true,
        value: native
          ? class {
              static async getSupportedFormats() {
                return ["code_128", "ean_13", "ean_8", "upc_a", "upc_e"];
              }
              async detect() {
                return [{ rawValue: value }, { rawValue: value }];
              }
            }
          : undefined,
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 480;
            const context = canvas.getContext("2d")!;
            context.fillStyle = "white";
            context.fillRect(0, 0, 640, 480);
            // Exact Code 128 B fixture for AB: start104, A33, B34, checksum102, stop.
            const bars =
              "110100100001010001100010001011000111101011101100011101011";
            context.fillStyle = "black";
            Array.from(bars).forEach((bit, index) => {
              if (bit === "1") context.fillRect(170 + index * 5, 80, 5, 320);
            });
            const stream = canvas.captureStream(5);
            const track = stream.getVideoTracks()[0]!;
            const stop = track.stop.bind(track);
            track.stop = () => {
              document.body.dataset.cameraStopped = "yes";
              stop();
            };
            document.body.dataset.cameraOpened = "yes";
            return stream;
          },
        },
      });
    },
    { native, value },
  );
}

test("live camera UI closes safely and restores scanner focus", async ({
  page,
}, testInfo) => {
  await fakeCamera(page, true, "");
  await stubPos(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(posPath);
  await page.getByRole("button", { name: "Scan with camera" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText("Scanning…");
  await page.screenshot({ path: testInfo.outputPath("camera-live-375.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("camera-live-1440.png") });
  await dialog.getByRole("button", { name: "Close camera" }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-camera-stopped",
    "yes",
  );
  await expect(page.getByLabel("Scan or enter barcode")).toBeFocused();
  await scan(page, "00AbC");
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
});

test("mock native detection adds once, stops tracks and permits an intentional second scan", async ({
  page,
}) => {
  await fakeCamera(page, true);
  const scans = await stubPos(page);
  await page.goto(posPath);
  expect(
    await page.locator("body").getAttribute("data-camera-opened"),
  ).toBeNull();
  for (const quantity of ["1", "2"]) {
    await page.getByRole("button", { name: "Scan with camera" }).click();
    await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue(
      quantity,
    );
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(
      "data-camera-stopped",
      "yes",
    );
  }
  expect(scans).toEqual(["00AbC", "00AbC"]);
});

test("real ZXing fallback decodes a synthetic Code 128 camera stream", async ({
  page,
}) => {
  await fakeCamera(page, false);
  const scans = await stubPos(page);
  await page.goto(posPath);
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
  expect(scans).toEqual(["AB"]);
  await expect(page.locator("body")).toHaveAttribute(
    "data-camera-stopped",
    "yes",
  );
});

test("camera lookup failure stops media and leaves manual retry available", async ({
  page,
}) => {
  await fakeCamera(page, true, "server-error");
  await stubPos(page);
  await page.goto(posPath);
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(
    page.getByText(/Could not look up barcode server-error/),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-camera-stopped",
    "yes",
  );
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await scan(page, "00AbC");
  await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
});

for (const width of [375, 430, 768, 1024, 1280, 1440]) {
  test(`scanner, cart and camera dialog fit and are accessible at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      }),
    );
    await stubPos(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(posPath);
    await scan(page, "00AbC");
    await expect(page.getByLabel("Quantity for Coffee (EA)")).toHaveValue("1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`pos-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Scan with camera" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`camera-${width}.png`) });
    if (width === 375) {
      await page.setViewportSize({ width: 900, height: 375 });
      await dialog
        .getByRole("button", { name: "Close camera" })
        .scrollIntoViewIfNeeded();
      await expect(
        dialog.getByRole("button", { name: "Close camera" }),
      ).toBeInViewport();
    }
    await dialog.getByRole("button", { name: "Close camera" }).click();
  });
}
