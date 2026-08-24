// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OnboardingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

describe("P2-M3-T01 onboarding page", () => {
  it("renders the real onboarding form", () => {
    render(<OnboardingPage />);

    expect(
      screen.getByRole("heading", { name: "Set up StockWise" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByLabelText("First branch name")).toBeTruthy();
  });
});
