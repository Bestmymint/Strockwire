// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage, { metadata as homeMetadata } from "@/app/page";
import PricingPage, { metadata as pricingMetadata } from "@/app/pricing/page";

import { MarketingShell } from "./marketing-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/pricing" }));
afterEach(cleanup);

describe("public marketing", () => {
  it("uses actual auth destinations and a feature anchor without extra routes", () => {
    render(
      <MarketingShell>
        <HomePage />
      </MarketingShell>,
    );
    const navigation = within(
      screen.getByRole("navigation", { name: "Public navigation" }),
    );
    for (const [name, href] of [
      ["Features", "/#features"],
      ["Pricing", "/pricing"],
      ["Sign in", "/login"],
      ["Get started", "/register"],
    ] as const) {
      expect(navigation.getByRole("link", { name }).getAttribute("href")).toBe(
        href,
      );
    }
    expect(
      screen
        .getByRole("link", { name: "Create your account" })
        .getAttribute("href"),
    ).toBe("/register");
    expect(
      screen.getByRole("heading", { name: /Less guesswork/ }).closest("section")
        ?.id,
    ).toBe("features");
    expect(screen.getByRole("list").children.length).toBe(4);
    expect(
      screen.getByRole("heading", { name: /See the pattern/ }),
    ).toBeTruthy();
    expect(homeMetadata.title).toBeTruthy();
    expect(homeMetadata.description).toBeTruthy();
  });

  it("presents three proposed plans without prices, plan selection, or payment controls", () => {
    render(<PricingPage />);
    const plans = within(
      screen.getByRole("region", { name: "Proposed plans" }),
    );
    expect(plans.getAllByRole("article").length).toBe(3);
    for (const name of ["Starter", "Growth", "Business"]) {
      expect(plans.getByRole("heading", { name })).toBeTruthy();
    }
    expect(plans.getAllByText("Coming soon").length).toBe(3);
    for (const link of plans.getAllByRole("link", {
      name: "Create an account",
    })) {
      expect(link.getAttribute("href")).toBe("/register");
    }
    expect(
      screen.getByText(
        /Prices, feature inclusions, branch and user allowances/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/does not select a plan/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(pricingMetadata.title).toBeTruthy();
    expect(pricingMetadata.description).toBeTruthy();
  });

  it("toggles the menu, closes on navigation, and returns focus on Escape", () => {
    render(
      <MarketingShell>
        <p>Public content</p>
      </MarketingShell>,
    );
    const button = screen.getByRole("button", { name: "Menu" });
    const navigation = screen.getByRole("navigation", {
      name: "Public navigation",
    });
    expect(button.getAttribute("aria-controls")).toBe(navigation.id);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const pricing = within(navigation).getByRole("link", { name: "Pricing" });
    expect(pricing.getAttribute("aria-current")).toBe("page");
    pricing.focus();
    fireEvent.keyDown(pricing, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(within(navigation).getByRole("link", { name: "Features" }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
