import { describe, expect, it } from "vitest";

import { DEFAULT_REDIRECT, safeRedirect } from "@/lib/auth/redirect";

describe("safeRedirect", () => {
  it("keeps root-relative application paths", () => {
    expect(safeRedirect("/dashboard/contacts")).toBe("/dashboard/contacts");
    expect(safeRedirect("/dashboard?tab=open")).toBe("/dashboard?tab=open");
    expect(safeRedirect("/store/my-shop#top")).toBe("/store/my-shop#top");
  });

  it("falls back when nothing usable is supplied", () => {
    expect(safeRedirect(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("   ")).toBe(DEFAULT_REDIRECT);
  });

  it("refuses absolute and protocol-relative URLs", () => {
    expect(safeRedirect("https://evil.example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("http://evil.example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("//evil.example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("javascript:alert(1)")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("data:text/html,<script>")).toBe(DEFAULT_REDIRECT);
  });

  it("refuses backslash and whitespace smuggling", () => {
    expect(safeRedirect("/\\evil.example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/\tevil.example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/\n/evil.example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/ /evil.example.com")).toBe(DEFAULT_REDIRECT);
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeRedirect("https://evil.example.com", "/onboarding")).toBe(
      "/onboarding",
    );
  });
});
