// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage from "@/app/page";

import { AppShell } from "./app-shell";

afterEach(cleanup);

describe("web application shell", () => {
  it("renders its only route with accessible shell landmarks", () => {
    render(
      <AppShell>
        <HomePage />
      </AppShell>,
    );

    expect(
      screen
        .getByRole("link", { name: "Skip to main content" })
        .getAttribute("href"),
    ).toBe("#main-content");
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("id")).toBe("main-content");
    expect(
      screen.getByRole("heading", { level: 1, name: "StockWise web shell" }),
    ).toBeTruthy();
  });
});
