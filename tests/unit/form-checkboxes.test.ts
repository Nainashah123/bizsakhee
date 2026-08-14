import { describe, expect, it } from "vitest";

import { onboardingSchema } from "@/lib/validation/onboarding";
import { workspaceSettingsSchema } from "@/lib/validation/workspace";

/**
 * An unchecked checkbox submits nothing at all, so its key is simply absent
 * from FormData. Every one of these schemas once modelled that with
 * z.union([..., z.undefined()]), which does NOT make a key optional in Zod 4:
 * the field stayed required and a missing key failed with "expected
 * nonoptional".
 *
 * The effect was that onboarding could not be completed by anyone who left the
 * demo-data box unticked - the default - so no workspace could be created at
 * all. These tests exist so that never ships again.
 */

const onboardingBase = {
  fullName: "Naina Shah",
  language: "en",
  businessName: "Naina Boutique",
  category: "boutique",
  city: "",
  country: "IN",
  primaryChannel: "whatsapp",
  whatsappNumber: "",
  currency: "INR",
};

describe("onboarding: unchecked demo-data box", () => {
  it("parses when includeDemoData is absent entirely", () => {
    const result = onboardingSchema.safeParse(onboardingBase);

    expect(
      result.success,
      result.success ? "" : JSON.stringify(result.error.issues),
    ).toBe(true);
    if (!result.success) return;
    expect(result.data.includeDemoData).toBe(false);
  });

  it('treats "on" as opted in', () => {
    const result = onboardingSchema.safeParse({
      ...onboardingBase,
      includeDemoData: "on",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.includeDemoData).toBe(true);
  });

  it('treats an explicit "false" as opted out', () => {
    const result = onboardingSchema.safeParse({
      ...onboardingBase,
      includeDemoData: "false",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.includeDemoData).toBe(false);
  });
});

const settingsBase = {
  name: "Naina Boutique",
  currency: "INR",
  businessName: "Naina Boutique",
  category: "boutique",
  primaryChannel: "whatsapp",
};

describe("workspace settings: catalogue switch", () => {
  it("saves with the catalogue switched off, which submits no value", () => {
    const result = workspaceSettingsSchema.safeParse(settingsBase);

    expect(
      result.success,
      result.success ? "" : JSON.stringify(result.error.issues),
    ).toBe(true);
    if (!result.success) return;
    expect(result.data.isCataloguePublic).toBe(false);
  });

  it("saves with the catalogue switched on", () => {
    const result = workspaceSettingsSchema.safeParse({
      ...settingsBase,
      isCataloguePublic: "on",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isCataloguePublic).toBe(true);
  });
});
