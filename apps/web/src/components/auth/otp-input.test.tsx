// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { OtpInput } from "./otp-input";

afterEach(cleanup);

function renderOtp(initialValue = "012345"): HTMLInputElement {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <OtpInput
        describedBy="otp-help"
        id="verification-code"
        invalid
        onChange={setValue}
        value={value}
      />
    );
  }

  render(<Harness />);
  return screen.getByRole("textbox", { name: "6-digit verification code" });
}

function paste(input: HTMLInputElement, text: string) {
  fireEvent.paste(input, {
    clipboardData: { getData: () => text },
  });
}

describe("OTP input", () => {
  it("replaces only the selected digits on paste and places the caret after them", () => {
    const input = renderOtp();
    input.setSelectionRange(2, 3);

    paste(input, "9");

    expect(input.value).toBe("019345");
    expect(input).toHaveProperty("selectionStart", 3);
    expect(input).toHaveProperty("selectionEnd", 3);
  });

  it("keeps the caret mapped through invalid characters at the beginning, middle, and end", () => {
    const input = renderOtp();

    input.setSelectionRange(0, 0);
    fireEvent.change(input, {
      target: { value: "x012345", selectionStart: 1 },
    });
    expect(input.value).toBe("012345");
    expect(input.selectionStart).toBe(0);

    input.setSelectionRange(3, 3);
    fireEvent.change(input, {
      target: { value: "012x345", selectionStart: 4 },
    });
    expect(input.value).toBe("012345");
    expect(input.selectionStart).toBe(3);

    input.setSelectionRange(6, 6);
    fireEvent.change(input, {
      target: { value: "012345x", selectionStart: 7 },
    });
    expect(input.value).toBe("012345");
    expect(input.selectionStart).toBe(6);
  });

  it("maps a selected native replacement and retains the caret for the next digit", () => {
    const input = renderOtp();
    input.setSelectionRange(2, 3);

    fireEvent.change(input, { target: { value: "01a345", selectionStart: 3 } });

    expect(input.value).toBe("01345");
    expect(input.selectionStart).toBe(2);
    fireEvent.change(input, { target: { value: "019345", selectionStart: 3 } });
    expect(input.value).toBe("019345");
    expect(input.selectionStart).toBe(3);
  });

  it("preserves zeroes and maps caret after deleting digits with Backspace or Delete", () => {
    const input = renderOtp();
    input.setSelectionRange(2, 2);
    fireEvent.change(input, { target: { value: "01345", selectionStart: 2 } });
    expect(input.value).toBe("01345");
    expect(input.selectionStart).toBe(2);

    input.setSelectionRange(2, 2);
    fireEvent.change(input, { target: { value: "0145", selectionStart: 2 } });
    expect(input.value).toBe("0145");
    expect(input.selectionStart).toBe(2);
  });

  it("sanitizes a partial mixed paste into a selected range and respects the six-digit limit", () => {
    const input = renderOtp();
    input.setSelectionRange(2, 4);

    paste(input, "9x8");

    expect(input.value).toBe("019845");
    expect(input.selectionStart).toBe(4);

    input.setSelectionRange(1, 1);
    paste(input, "7654321");
    expect(input.value).toBe("076543");
    expect(input.selectionStart).toBe(6);
  });

  it("inserts at the caret and truncates the resulting code to six digits", () => {
    const input = renderOtp("12345");
    input.setSelectionRange(2, 2);

    paste(input, "6789");

    expect(input.value).toBe("126789");
    expect(input).toHaveProperty("selectionStart", 6);
  });

  it("supports pasting a complete code into an empty input", () => {
    const input = renderOtp("");
    input.setSelectionRange(0, 0);

    paste(input, "12-34x56");

    expect(input.value).toBe("123456");
    expect(input).toHaveProperty("selectionStart", 6);
  });

  it("ignores a clipboard value with no ASCII digits without changing the selection or code", () => {
    const input = renderOtp();
    input.setSelectionRange(1, 4);

    paste(input, "１２٣abc");

    expect(input.value).toBe("012345");
    expect(input).toHaveProperty("selectionStart", 1);
    expect(input).toHaveProperty("selectionEnd", 4);
  });

  it("sanitizes native input changes while preserving accessible error association", () => {
    const input = renderOtp();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("maxlength")).toBe("6");
    expect(input.getAttribute("required")).not.toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe("otp-help");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "01345" } });
    expect(input.value).toBe("01345");
    fireEvent.change(input, { target: { value: "01a34567" } });
    expect(input.value).toBe("013456");
  });
});
