import { describe, expect, it } from "vitest";

import {
  computeOrderTotals,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  outstandingMinor,
  type OrderLineInput,
  type OrderTotals,
} from "@/lib/orders/totals";

/** A line helper so each test only states the numbers that matter to it. */
function line(
  unitPriceMinor: number,
  quantity = 1,
  description = "Item",
): OrderLineInput {
  return { description, quantity, unitPriceMinor };
}

/**
 * Money that leaves this module is written straight into the database and onto
 * an invoice, so a float escaping anywhere is a corruption bug, not a display
 * nit. Every test funnels its result through this.
 */
function expectAllIntegers(totals: OrderTotals): void {
  expect(Number.isInteger(totals.subtotalMinor)).toBe(true);
  expect(Number.isInteger(totals.discountMinor)).toBe(true);
  expect(Number.isInteger(totals.taxableMinor)).toBe(true);
  expect(Number.isInteger(totals.taxBasisPoints)).toBe(true);
  expect(Number.isInteger(totals.taxMinor)).toBe(true);
  expect(Number.isInteger(totals.shippingMinor)).toBe(true);
  expect(Number.isInteger(totals.totalMinor)).toBe(true);
  for (const item of totals.lines) {
    expect(Number.isInteger(item.quantity)).toBe(true);
    expect(Number.isInteger(item.unitPriceMinor)).toBe(true);
    expect(Number.isInteger(item.lineTotalMinor)).toBe(true);
  }
}

describe("computeOrderTotals - summation", () => {
  it("totals a single line", () => {
    // 1 x ₹2,499.00 = 249900 paise. No discount, no tax, no shipping.
    const totals = computeOrderTotals({ lines: [line(249900)] });

    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0].lineTotalMinor).toBe(249900);
    expect(totals.subtotalMinor).toBe(249900);
    expect(totals.discountMinor).toBe(0);
    expect(totals.taxableMinor).toBe(249900);
    expect(totals.taxMinor).toBe(0);
    expect(totals.shippingMinor).toBe(0);
    expect(totals.totalMinor).toBe(249900);
    expectAllIntegers(totals);
  });

  it("sums a multi-line order exactly", () => {
    // 1 x 149900 = 149900
    // 3 x  24900 =  74700
    // 2 x   4950 =   9900
    // subtotal   = 149900 + 74700 + 9900 = 234500
    const totals = computeOrderTotals({
      lines: [
        line(149900, 1, "Kanjivaram saree"),
        line(24900, 3, "Cotton dupatta"),
        line(4950, 2, "Gift wrap"),
      ],
    });

    expect(totals.lines.map((item) => item.lineTotalMinor)).toEqual([
      149900, 74700, 9900,
    ]);
    expect(totals.subtotalMinor).toBe(234500);
    expect(totals.totalMinor).toBe(234500);
    expectAllIntegers(totals);
  });

  it("multiplies quantity greater than one", () => {
    // 7 x 12345 = 86415 paise.
    const totals = computeOrderTotals({ lines: [line(12345, 7)] });

    expect(totals.lines[0].quantity).toBe(7);
    expect(totals.lines[0].lineTotalMinor).toBe(86415);
    expect(totals.subtotalMinor).toBe(86415);
    expectAllIntegers(totals);
  });

  it("produces a zero total for an order with no lines, never NaN", () => {
    // An empty draft order is a real state in the UI; it must render ₹0.00.
    const totals = computeOrderTotals({
      lines: [],
      taxBasisPoints: 1800,
      shippingMinor: 0,
    });

    expect(totals.subtotalMinor).toBe(0);
    expect(totals.taxableMinor).toBe(0);
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(0);
    expect(Number.isNaN(totals.totalMinor)).toBe(false);
    expectAllIntegers(totals);
  });

  it("carries the product and variant references through, defaulting to null", () => {
    const totals = computeOrderTotals({
      lines: [
        {
          description: "Saree",
          quantity: 1,
          unitPriceMinor: 100,
          productId: "prod_1",
          variantId: "var_1",
        },
        { description: "Custom stitching", quantity: 1, unitPriceMinor: 100 },
      ],
    });

    expect(totals.lines[0].productId).toBe("prod_1");
    expect(totals.lines[0].variantId).toBe("var_1");
    // A free-text line has no catalogue row behind it.
    expect(totals.lines[1].productId).toBeNull();
    expect(totals.lines[1].variantId).toBeNull();
  });
});

describe("computeOrderTotals - tax", () => {
  it("applies 18% GST (1800 bps) AFTER the discount, not before", () => {
    // subtotal = 100000
    // discount =  10000 (fixed)
    // taxable  =  90000
    // tax      =  90000 x 1800 / 10000 = 16200
    // total    =  90000 + 16200 = 106200
    const totals = computeOrderTotals({
      lines: [line(100000)],
      discountMinor: 10000,
      taxBasisPoints: 1800,
    });

    expect(totals.taxableMinor).toBe(90000);
    expect(totals.taxMinor).toBe(16200);
    // If tax were taken on the pre-discount subtotal it would be 18000.
    expect(totals.taxMinor).not.toBe(18000);
    expect(totals.totalMinor).toBe(106200);
    expect(totals.taxBasisPoints).toBe(1800);
    expectAllIntegers(totals);
  });

  it("echoes back the tax rate it used", () => {
    const totals = computeOrderTotals({
      lines: [line(50000)],
      taxBasisPoints: 500,
    });

    // 50000 x 500 / 10000 = 2500
    expect(totals.taxBasisPoints).toBe(500);
    expect(totals.taxMinor).toBe(2500);
    expect(totals.totalMinor).toBe(52500);
  });

  it("rounds a half-paise of tax half away from zero", () => {
    // 25 paise at 10% = 2.5 paise. Half-up gives 3, not 2 (and not 2.5).
    const half = computeOrderTotals({
      lines: [line(25)],
      taxBasisPoints: 1000,
    });
    expect(half.taxMinor).toBe(3);
    expect(half.totalMinor).toBe(28); // 25 + 3
    expectAllIntegers(half);

    // 15 paise at 10% = 1.5 paise -> 2. Same rule, so the behaviour is
    // consistent rather than depending on whether the digit before is odd.
    const alsoHalf = computeOrderTotals({
      lines: [line(15)],
      taxBasisPoints: 1000,
    });
    expect(alsoHalf.taxMinor).toBe(2);
    expect(alsoHalf.totalMinor).toBe(17); // 15 + 2
    expectAllIntegers(alsoHalf);

    // Just under a half still rounds down: 24 x 10% = 2.4 -> 2.
    const under = computeOrderTotals({
      lines: [line(24)],
      taxBasisPoints: 1000,
    });
    expect(under.taxMinor).toBe(2);
    expect(under.totalMinor).toBe(26);
  });

  it("rejects a tax rate outside 0-10000 basis points", () => {
    expect(() =>
      computeOrderTotals({ lines: [line(100)], taxBasisPoints: 10_001 }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ lines: [line(100)], taxBasisPoints: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ lines: [line(100)], taxBasisPoints: 18.5 }),
    ).toThrow(RangeError);
  });
});

describe("computeOrderTotals - discounts", () => {
  it("applies a fixed-amount discount", () => {
    // subtotal 200000 - 25000 = 175000 taxable, no tax, no shipping.
    const totals = computeOrderTotals({
      lines: [line(200000)],
      discountMinor: 25000,
    });

    expect(totals.discountMinor).toBe(25000);
    expect(totals.taxableMinor).toBe(175000);
    expect(totals.totalMinor).toBe(175000);
    expectAllIntegers(totals);
  });

  it("applies a basis-points discount", () => {
    // subtotal 200000, 12.5% = 1250 bps -> 200000 x 1250 / 10000 = 25000
    const totals = computeOrderTotals({
      lines: [line(200000)],
      discountBasisPoints: 1250,
    });

    expect(totals.discountMinor).toBe(25000);
    expect(totals.taxableMinor).toBe(175000);
    expectAllIntegers(totals);
  });

  it("lets the fixed amount win when both discounts are supplied", () => {
    // Documented contract: discountMinor > 0 wins outright and
    // discountBasisPoints is ignored - the two are never stacked.
    // subtotal 200000; fixed 5000; bps 5000 would have been 100000.
    const totals = computeOrderTotals({
      lines: [line(200000)],
      discountMinor: 5000,
      discountBasisPoints: 5000,
    });

    expect(totals.discountMinor).toBe(5000);
    // Not the percentage (100000) and not the two stacked (105000).
    expect(totals.taxableMinor).toBe(195000);
    expectAllIntegers(totals);
  });

  it("falls back to the percentage when the fixed amount is zero", () => {
    // A form that always posts discountMinor=0 must not disable the percentage.
    // 200000 x 1000 / 10000 = 20000
    const totals = computeOrderTotals({
      lines: [line(200000)],
      discountMinor: 0,
      discountBasisPoints: 1000,
    });

    expect(totals.discountMinor).toBe(20000);
    expect(totals.taxableMinor).toBe(180000);
  });

  it("clamps a discount larger than the subtotal to zero, never negative", () => {
    // subtotal 50000, discount asked for 90000 -> clamped to 50000.
    const totals = computeOrderTotals({
      lines: [line(50000)],
      discountMinor: 90000,
      taxBasisPoints: 1800,
    });

    expect(totals.discountMinor).toBe(50000);
    expect(totals.taxableMinor).toBe(0);
    expect(totals.taxMinor).toBe(0); // no taxable base left
    expect(totals.totalMinor).toBe(0);
    expect(totals.totalMinor).toBeGreaterThanOrEqual(0);
    expect(totals.taxableMinor).toBeGreaterThanOrEqual(0);
    expectAllIntegers(totals);
  });

  it("still charges shipping when the discount wipes out the goods", () => {
    // taxable 0 + tax 0 + shipping 9900 = 9900. Shipping is not discounted.
    const totals = computeOrderTotals({
      lines: [line(50000)],
      discountMinor: 999_999,
      taxBasisPoints: 1800,
      shippingMinor: 9900,
    });

    expect(totals.discountMinor).toBe(50000);
    expect(totals.totalMinor).toBe(9900);
    expectAllIntegers(totals);
  });

  it("rejects a negative or fractional discount", () => {
    expect(() =>
      computeOrderTotals({ lines: [line(100)], discountMinor: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ lines: [line(100)], discountMinor: 10.5 }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ lines: [line(100)], discountBasisPoints: 10_001 }),
    ).toThrow(RangeError);
  });
});

describe("computeOrderTotals - shipping", () => {
  it("adds shipping after tax, and does not tax the shipping", () => {
    // subtotal = 100000, no discount
    // tax      = 100000 x 1800 / 10000 = 18000
    // shipping =   9900
    // total    = 100000 + 18000 + 9900 = 127900
    const totals = computeOrderTotals({
      lines: [line(100000)],
      taxBasisPoints: 1800,
      shippingMinor: 9900,
    });

    expect(totals.taxMinor).toBe(18000);
    // If shipping were folded in before tax, tax would be 109900 x 18% = 19782.
    expect(totals.taxMinor).not.toBe(19782);
    expect(totals.shippingMinor).toBe(9900);
    expect(totals.totalMinor).toBe(127900);
    expectAllIntegers(totals);
  });

  it("rejects negative or fractional shipping", () => {
    expect(() =>
      computeOrderTotals({ lines: [line(100)], shippingMinor: -100 }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ lines: [line(100)], shippingMinor: 99.9 }),
    ).toThrow(RangeError);
  });
});

describe("computeOrderTotals - a realistic Indian retail order", () => {
  it("gets the whole pipeline right in one go", () => {
    // 2 x 189900 = 379800
    // 1 x  45000 =  45000
    // subtotal   = 424800
    // discount   = 10% of 424800 = 42480
    // taxable    = 424800 - 42480 = 382320
    // GST 18%    = 382320 x 1800 / 10000 = 68817.6 -> 68818 (half-up)
    // shipping   = 15000
    // total      = 382320 + 68818 + 15000 = 466138
    const totals = computeOrderTotals({
      lines: [line(189900, 2, "Silk saree"), line(45000, 1, "Blouse")],
      discountBasisPoints: 1000,
      taxBasisPoints: 1800,
      shippingMinor: 15000,
    });

    expect(totals.subtotalMinor).toBe(424800);
    expect(totals.discountMinor).toBe(42480);
    expect(totals.taxableMinor).toBe(382320);
    expect(totals.taxMinor).toBe(68818);
    expect(totals.shippingMinor).toBe(15000);
    expect(totals.totalMinor).toBe(466138);
    expectAllIntegers(totals);
  });
});

describe("computeOrderTotals - guard rails", () => {
  it(`accepts exactly ${MAX_ORDER_LINES} lines and rejects one more`, () => {
    const atLimit = Array.from({ length: MAX_ORDER_LINES }, () => line(100));
    const totals = computeOrderTotals({ lines: atLimit });
    // 200 lines x 100 paise = 20000
    expect(totals.lines).toHaveLength(MAX_ORDER_LINES);
    expect(totals.subtotalMinor).toBe(MAX_ORDER_LINES * 100);

    const overLimit = [...atLimit, line(100)];
    expect(() => computeOrderTotals({ lines: overLimit })).toThrow(RangeError);
  });

  it(`accepts a quantity of exactly ${MAX_LINE_QUANTITY} and rejects one more`, () => {
    const atLimit = computeOrderTotals({
      lines: [line(1, MAX_LINE_QUANTITY)],
    });
    // 100000 x 1 paise = 100000
    expect(atLimit.subtotalMinor).toBe(MAX_LINE_QUANTITY);

    expect(() =>
      computeOrderTotals({ lines: [line(1, MAX_LINE_QUANTITY + 1)] }),
    ).toThrow(RangeError);
  });

  it("rounds a fractional quantity half away from zero rather than truncating", () => {
    // A CSV import that says 1.5 must not silently become 1 and short the seller.
    const up = computeOrderTotals({ lines: [line(1000, 1.5)] });
    expect(up.lines[0].quantity).toBe(2);
    expect(up.subtotalMinor).toBe(2000);

    const down = computeOrderTotals({ lines: [line(1000, 2.4)] });
    expect(down.lines[0].quantity).toBe(2);
    expect(down.subtotalMinor).toBe(2000);
  });

  it("rejects a quantity that is zero, negative or rounds to zero", () => {
    expect(() => computeOrderTotals({ lines: [line(1000, 0)] })).toThrow(
      RangeError,
    );
    expect(() => computeOrderTotals({ lines: [line(1000, -3)] })).toThrow(
      RangeError,
    );
    expect(() => computeOrderTotals({ lines: [line(1000, 0.4)] })).toThrow(
      RangeError,
    );
    expect(() =>
      computeOrderTotals({ lines: [line(1000, Number.NaN)] }),
    ).toThrow(RangeError);
    expect(() =>
      computeOrderTotals({ lines: [line(1000, Number.POSITIVE_INFINITY)] }),
    ).toThrow(RangeError);
  });

  it("rejects a unit price that is negative, fractional or not finite", () => {
    expect(() => computeOrderTotals({ lines: [line(-1)] })).toThrow(RangeError);
    expect(() => computeOrderTotals({ lines: [line(10.5)] })).toThrow(
      RangeError,
    );
    expect(() =>
      computeOrderTotals({ lines: [line(Number.POSITIVE_INFINITY)] }),
    ).toThrow(RangeError);
    expect(() => computeOrderTotals({ lines: [line(Number.NaN)] })).toThrow(
      RangeError,
    );
  });

  it("rejects an amount beyond the safe integer range", () => {
    expect(() =>
      computeOrderTotals({
        lines: [line(100)],
        shippingMinor: Number.MAX_SAFE_INTEGER + 2,
      }),
    ).toThrow(RangeError);
  });
});

describe("outstandingMinor", () => {
  it("owes the whole total when nothing has been paid", () => {
    expect(outstandingMinor(249900, 0)).toBe(249900);
  });

  it("owes the remainder after a part payment", () => {
    // 249900 - 100000 = 149900
    expect(outstandingMinor(249900, 100000)).toBe(149900);
  });

  it("owes nothing once paid in full", () => {
    expect(outstandingMinor(249900, 249900)).toBe(0);
  });

  it("never returns a negative amount on an overpayment", () => {
    // Paid 300000 against 249900: the seller owes a refund, but "outstanding"
    // must read 0 rather than -50100, which would corrupt any due-amount sum.
    const result = outstandingMinor(249900, 300000);
    expect(result).toBe(0);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("returns whole minor units", () => {
    // Half-up on each side: 100.5 -> 101, 50.5 -> 51, difference 50.
    const result = outstandingMinor(100.5, 50.5);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(50);
  });

  it("is zero for a zero-value order", () => {
    expect(outstandingMinor(0, 0)).toBe(0);
  });

  it("agrees with a computed order total", () => {
    // subtotal 100000 + 18% GST 18000 = 118000; customer paid 50000.
    const totals = computeOrderTotals({
      lines: [line(100000)],
      taxBasisPoints: 1800,
    });
    expect(totals.totalMinor).toBe(118000);
    expect(outstandingMinor(totals.totalMinor, 50000)).toBe(68000);
  });
});
