// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useLanguage } from "./language-provider";
function Probe() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <>
      <span>
        {language}:{t("catalog")}
      </span>
      <button onClick={() => setLanguage("en")}>English</button>
      <button onClick={() => setLanguage("th")}>ไทย</button>
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("navigator", { language: "en-US" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("local language preference", () => {
  it.each([
    ["th-TH", "th", "สินค้า"],
    ["fr-FR", "en", "Catalog"],
  ])("defaults safely from browser %s", (browser, language, label) => {
    vi.stubGlobal("navigator", { language: browser });
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByText(language + ":" + label)).toBeTruthy();
    expect(document.documentElement.lang).toBe(language);
    expect(localStorage.getItem("stockwise.language")).toBeNull();
  });
  it("persists explicit choice, updates HTML lang and restores it after remount", () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ไทย" }));
    expect(localStorage.getItem("stockwise.language")).toBe("th");
    expect(document.documentElement.lang).toBe("th");
    cleanup();
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByText("th:สินค้า")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
  });
  it("ignores an invalid stored language", () => {
    localStorage.setItem("stockwise.language", "xx");
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByText("en:Catalog")).toBeTruthy();
  });
  it("allows selection when storage access is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ไทย" }));
    expect(document.documentElement.lang).toBe("th");
    expect(screen.getByText("th:สินค้า")).toBeTruthy();
  });
});
