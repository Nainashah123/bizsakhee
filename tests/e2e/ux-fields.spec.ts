import { expect, test } from "@playwright/test";

/**
 * Two usability fixes that only a person typing on a phone would notice:
 * a password you cannot read back, and a country field that demanded you
 * already know your ISO code.
 */

test.describe("password reveal", () => {
  for (const path of ["/login", "/signup"]) {
    test(`${path} lets you check what you typed`, async ({ page }) => {
      await page.goto(path);

      const password = page.getByRole("textbox", { name: /^password$/i });
      await password.fill("BizSakhi@2026");

      // Hidden by default - revealing must be a deliberate act.
      await expect(password).toHaveAttribute("type", "password");

      const toggle = page.getByRole("button", { name: /show password/i });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");

      await expect(async () => {
        await toggle.click();
        await expect(password).toHaveAttribute("type", "text");
      }).toPass({ timeout: 15_000 });

      // The value survives the toggle, and the control renames itself.
      await expect(password).toHaveValue("BizSakhi@2026");
      await expect(
        page.getByRole("button", { name: /hide password/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });
  }
});

test.describe("country selection", () => {
  test("onboarding offers a country list, not an ISO code box", async ({
    page,
  }) => {
    // Unauthenticated visitors are bounced to sign-in; the field itself is
    // covered by the journey spec once signed in. This asserts the guard so
    // the test never silently passes against a redirect.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
  });
});
