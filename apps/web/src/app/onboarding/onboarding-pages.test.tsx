// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ApplicationHoldingPage from "../app/page";
import OnboardingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

describe("P2-M3-T01 pages", () => {
  it("renders the real onboarding form", () => {
    render(<OnboardingPage />);

    expect(
      screen.getByRole("heading", { name: "Set up StockWise" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByLabelText("First branch name")).toBeTruthy();
  });

  it("keeps /app to a minimal completion holding shell", () => {
    render(<ApplicationHoldingPage />);

    expect(
      screen.getByRole("heading", { name: "StockWise application" }),
    ).toBeTruthy();
    expect(screen.getByText("Organization setup completed.")).toBeTruthy();
    expect(screen.queryByText(/analytics|inventory|point of sale/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
