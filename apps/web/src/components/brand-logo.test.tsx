// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandLogo } from "./brand-logo";

describe("brand logo", () => {
  it("exposes a single accessible StockWise image", () => {
    render(<BrandLogo />);
    expect(screen.getByRole("img", { name: "StockWise" })).toBeTruthy();
  });

  it("renders both theme variants for runtime theme switching", () => {
    render(<BrandLogo />);
    const light = document.querySelector(
      'img[src*="logo-light"]',
    ) as HTMLImageElement;
    const dark = document.querySelector(
      'img[src*="logo-dark"]',
    ) as HTMLImageElement;
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    // Light-mode asset is shown by default and hidden in dark mode; the
    // dark-mode asset is the reverse, so the theme switches without reload.
    expect(light.className).toContain("dark:hidden");
    expect(dark.className).toContain("dark:block");
  });
});
