import { describe, expect, it } from "vitest";

import {
  applyBasisPoints,
  formatMoney,
  isCurrencyCode,
  roundMinor,
  sumMinor,
  toMajorUnits,
  toMinorUnits,
} from "@/lib/money";

describe("toMinorUnits", () => {
  it("converts major units to integer minor units", () => {
    expect(toMinorUnits(1249.5)).toBe(124950);
    expect(toMinorUnits("1,249.50")).toBe(124950);
    expect(toMinorUnits("₹ 0".replace("₹", ""))).toBe(0);
  });

  it("avoids binary floating point drift", () => {
    // 0.1 + 0.2 style inputs must not produce 1010 or 3029.
    expect(toMinorUnits(10.1)).toBe(1010);
    expect(toMinorUnits(30.3)).toBe(3030);
    expect(toMinorUnits(1.005)).toBe(101);
  });

  it("rejects unparseable input", () => {
    expect(() => toMinorUnits("abc")).toThrow(RangeError);
    expect(() => toMinorUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe("roundMinor", () => {
  it("rounds half away from zero", () => {
    expect(roundMinor(2.5)).toBe(3);
    expect(roundMinor(-2.5)).toBe(-3);
    expect(roundMinor(2.4)).toBe(2);
  });
});

describe("applyBasisPoints", () => {
  it("applies GST at 18% (1800 bps)", () => {
    expect(applyBasisPoints(100000, 1800)).toBe(18000);
  });

  it("rounds to whole minor units", () => {
    expect(applyBasisPoints(999, 1800)).toBe(180);
  });

  it("rejects negative or fractional basis points", () => {
    expect(() => applyBasisPoints(100, -1)).toThrow(RangeError);
    expect(() => applyBasisPoints(100, 1.5)).toThrow(RangeError);
  });
});

describe("sumMinor", () => {
  it("sums integer minor amounts exactly", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(sumMinor([])).toBe(0);
  });
});

describe("display helpers", () => {
  it("round-trips to major units", () => {
    expect(toMajorUnits(124950)).toBe(1249.5);
  });

  it("formats INR with the Indian numbering system", () => {
    // Non-breaking spaces vary by ICU build, so compare on digits.
    expect(formatMoney(12499900).replace(/\s/g, "")).toBe("₹1,24,999.00");
  });

  it("recognises supported currency codes", () => {
    expect(isCurrencyCode("INR")).toBe(true);
    expect(isCurrencyCode("XYZ")).toBe(false);
  });
});
