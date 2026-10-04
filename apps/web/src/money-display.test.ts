import { describe, expect, it } from "vitest";

import { formatMoney, formatThb } from "./money-display";

describe("exact monetary display", () => {
  it.each([
    ["4", "4.00"],
    ["4.0", "4.00"],
    ["4.00", "4.00"],
    ["4.0000", "4.00"],
    ["4.5000", "4.50"],
    ["4.1200", "4.12"],
    ["4.123", "4.123"],
    ["4.1230", "4.123"],
    ["4.1234", "4.1234"],
    ["0", "0.00"],
    ["0.0000000000", "0.00"],
    ["-4.5000", "-4.50"],
    ["-0.0000", "-0.00"],
    ["+4.0000", "+4.00"],
    ["0004.1230", "0004.123"],
    ["9007199254740993.1234567890", "9007199254740993.123456789"],
    ["0.0000000001", "0.0000000001"],
  ])(
    "formats %s as %s without changing meaningful digits",
    (input, expected) => {
      expect(formatMoney(input)).toBe(expected);
    },
  );

  it("preserves exact digits with existing optional grouping and THB prefix", () => {
    const value = "-9007199254740993.1230";
    expect(formatMoney(value, true)).toBe("-9,007,199,254,740,993.123");
    expect(formatThb(value, true)).toBe("THB -9,007,199,254,740,993.123");
    expect(formatThb("4.0000")).toBe("THB 4.00");
    expect(value).toBe("-9007199254740993.1230");
  });

  it.each(["", "NaN", "Infinity", "1e3", " 4.00", "4.", "1,000.00"])(
    "rejects non-decimal input %s instead of coercing it",
    (input) => expect(() => formatMoney(input)).toThrow(RangeError),
  );
});
