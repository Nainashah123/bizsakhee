import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  whatsappLink,
} from "@/lib/contacts/normalize";

describe("normalizePhone", () => {
  it("treats the same Indian number written four ways as one contact", () => {
    const forms = [
      "+91 98765 43210",
      "919876543210",
      "09876543210",
      "98765-43210",
    ];
    const normalized = forms.map((form) => normalizePhone(form)?.normalized);
    expect(new Set(normalized)).toEqual(new Set(["919876543210"]));
  });

  it("keeps an explicit international prefix", () => {
    expect(normalizePhone("+971 50 123 4567")?.normalized).toBe("971501234567");
    expect(normalizePhone("0044 7700 900123")?.normalized).toBe("447700900123");
  });

  it("applies the workspace country when no code is given", () => {
    expect(normalizePhone("81234567", "SG")?.normalized).toBe("6581234567");
  });

  it("rejects values that cannot be a phone number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("no digits here")).toBeNull();
  });

  it("produces a readable display form", () => {
    expect(normalizePhone("9876543210")?.display).toBe("+91 98765 43210");
  });
});

describe("whatsappLink", () => {
  it("builds a wa.me deep link", () => {
    expect(whatsappLink("919876543210")).toBe("https://wa.me/919876543210");
  });

  it("encodes a prefilled message", () => {
    expect(whatsappLink("919876543210", "Hi Meera!")).toBe(
      "https://wa.me/919876543210?text=Hi%20Meera!",
    );
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Meera@Example.COM ")).toBe("meera@example.com");
  });

  it("returns null for blank input", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("normalizeName", () => {
  it("collapses whitespace for comparison", () => {
    expect(normalizeName("  Meera   Nair ")).toBe("meera nair");
  });
});
