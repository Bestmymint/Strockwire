// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage, { metadata as homeMetadata } from "@/app/page";
import PricingPage, { metadata as pricingMetadata } from "@/app/pricing/page";
import { MarketingShell } from "./marketing-shell";
vi.mock("next/navigation", () => ({ usePathname: () => "/pricing" }));
afterEach(cleanup);
describe("public marketing", () => {
  it("uses real navigation and labels the illustrative product data", () => {
    render(
      <MarketingShell>
        <HomePage />
      </MarketingShell>,
    );
    const nav = within(
      screen.getByRole("navigation", { name: "Public navigation" }),
    );
    for (const [name, href] of [
      ["Features", "/#features"],
      ["Pricing", "/pricing"],
      ["Sign in", "/login"],
      ["Get started", "/register"],
    ] as const) {
      expect(nav.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
    expect(
      screen.getByRole("heading", { name: "Run your inventory with clarity." }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("heading", { name: "The essentials, connected." })
        .closest("section")?.id,
    ).toBe("features");
    expect(screen.getByRole("list").children.length).toBe(5);
    expect(screen.getAllByText("Illustrative data").length).toBeGreaterThan(0);
    expect(homeMetadata.title).toBeTruthy();
    expect(homeMetadata.description).toBeTruthy();
  });
  it("keeps proposed plans presentation-only without payment controls", () => {
    render(<PricingPage />);
    const plans = within(
      screen.getByRole("region", { name: "Proposed plans" }),
    );
    expect(plans.getAllByRole("article").length).toBe(3);
    for (const name of ["Starter", "Growth", "Business"])
      expect(plans.getByRole("heading", { name })).toBeTruthy();
    expect(plans.getAllByText("Coming soon").length).toBe(3);
    for (const link of plans.getAllByRole("link", {
      name: "Create an account",
    }))
      expect(link.getAttribute("href")).toBe("/register");
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
  it("uses an accessible official Sheet and closes after navigation", async () => {
    render(
      <MarketingShell>
        <p>Public content</p>
      </MarketingShell>,
    );
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Menu" });
    const pricing = within(dialog).getByRole("link", { name: "Pricing" });
    expect(pricing.getAttribute("aria-current")).toBe("page");
    fireEvent.click(pricing);
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
  });
});
