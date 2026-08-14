import { describe, expect, it } from "vitest";

import {
  SLUG_MAX_LENGTH,
  isValidProductSlug,
  nextAvailableSlug,
  slugify,
  toProductSlug,
} from "@/lib/validation/products";

/** The exact CHECK constraint on `products.slug` in the commerce migration. */
const DB_CONSTRAINT = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

describe("slugify", () => {
  it("lowercases and hyphenates a product name", () => {
    expect(slugify("Hand Painted Diya Set")).toBe("hand-painted-diya-set");
  });

  it("drops punctuation instead of encoding it", () => {
    expect(slugify("Mom's Special: Ghee (500g)!")).toBe(
      "mom-s-special-ghee-500g",
    );
  });

  it("folds accents to their ASCII base letter", () => {
    expect(slugify("Café Latté Candle")).toBe("cafe-latte-candle");
  });

  it("collapses runs of separators and trims the edges", () => {
    expect(slugify("  --Red   //  Blue--  ")).toBe("red-blue");
  });

  it("returns an empty string when nothing Latin survives", () => {
    expect(slugify("आम का अचार")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("truncates to the column limit without a trailing hyphen", () => {
    const name = `${"a".repeat(78)} bcd`;
    const slug = slugify(name);

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(DB_CONSTRAINT.test(slug)).toBe(true);
  });

  it("never produces a value the database would reject", () => {
    const names = [
      "Hand Painted Diya Set",
      "Mom's Special: Ghee (500g)!",
      "  --Red   //  Blue--  ",
      "Café Latté Candle",
      "2024 Diwali Hamper #1",
      "x",
      `${"long name ".repeat(20)}`,
    ];

    for (const name of names) {
      expect(isValidProductSlug(toProductSlug(name))).toBe(true);
      expect(DB_CONSTRAINT.test(toProductSlug(name))).toBe(true);
    }
  });
});

describe("toProductSlug", () => {
  it("falls back to a usable slug for a non-Latin name", () => {
    expect(toProductSlug("आम का अचार")).toBe("product");
  });
});

describe("nextAvailableSlug", () => {
  it("uses the base slug when it is free", () => {
    expect(nextAvailableSlug("diya-set", ["candle", "ghee"])).toBe("diya-set");
  });

  it("appends -2 on the first collision", () => {
    expect(nextAvailableSlug("diya-set", ["diya-set"])).toBe("diya-set-2");
  });

  it("keeps counting past an existing suffix", () => {
    expect(
      nextAvailableSlug("diya-set", ["diya-set", "diya-set-2", "diya-set-3"]),
    ).toBe("diya-set-4");
  });

  it("skips gaps rather than reusing a taken suffix", () => {
    expect(nextAvailableSlug("diya-set", ["diya-set", "diya-set-3"])).toBe(
      "diya-set-2",
    );
  });

  it("ignores slugs that merely start with the base", () => {
    // "diya-set-deluxe" is a different product, not a numbered collision.
    expect(nextAvailableSlug("diya-set", ["diya-set-deluxe"])).toBe("diya-set");
  });

  it("keeps the suffixed slug inside the column limit", () => {
    const base = "a".repeat(SLUG_MAX_LENGTH);
    const taken = [base];
    const result = nextAvailableSlug(base, taken);

    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(result.endsWith("-2")).toBe(true);
    expect(DB_CONSTRAINT.test(result)).toBe(true);
  });

  it("stays valid when truncation would land on a hyphen", () => {
    // 79 chars ending in "-" so slicing for "-2" leaves a trailing hyphen.
    const base = `${"ab-".repeat(26)}a`;
    expect(base.length).toBe(79);

    const result = nextAvailableSlug(base, [base], { maxAttempts: 2 });
    expect(DB_CONSTRAINT.test(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it("falls back to a random suffix once the counter is exhausted", () => {
    const base = "diya-set";
    const taken = [
      base,
      ...Array.from({ length: 9 }, (_, i) => `${base}-${i + 2}`),
    ];

    const result = nextAvailableSlug(base, taken, {
      maxAttempts: 10,
      randomSuffix: () => "k7f2qa",
    });

    expect(result).toBe("diya-set-k7f2qa");
    expect(taken).not.toContain(result);
    expect(DB_CONSTRAINT.test(result)).toBe(true);
  });

  it("substitutes a fallback root when the base is empty", () => {
    expect(nextAvailableSlug("", [])).toBe("product");
    expect(nextAvailableSlug("", ["product"])).toBe("product-2");
  });

  it("is deterministic for the same inputs", () => {
    const taken = ["ghee", "ghee-2"];
    expect(nextAvailableSlug("ghee", taken)).toBe(
      nextAvailableSlug("ghee", taken),
    );
  });
});
