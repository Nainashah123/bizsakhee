import { expect, test } from "@playwright/test";

/**
 * Stage 1 and Stage 8: the public surface.
 *
 * These need no database and no credentials, so they run everywhere.
 */

test.describe("marketing site", () => {
  test("homepage states what the product does and offers both CTAs", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /organised, growing brand/i,
      }),
    ).toBeVisible();

    // Exactly one h1 - a real accessibility requirement, not decoration.
    await expect(page.locator("h1")).toHaveCount(1);

    await expect(
      page.getByRole("link", { name: /start free/i }).first(),
    ).toBeVisible();

    await expect(page).toHaveTitle(/BizSakhi/);
  });

  test("makes no unverifiable claims about users or revenue", async ({
    page,
  }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();

    // The brief forbids invented testimonials, user counts and revenue stats.
    expect(body).not.toMatch(
      /\d[\d,]*\+?\s*(happy\s+)?(users|customers|sellers)\b/i,
    );
    expect(body).not.toMatch(/trusted by [\d,]+/i);
    expect(body).not.toMatch(/\bcrore\b|\blakhs? in sales\b/i);
  });

  test("skip link is the first thing a keyboard reaches", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: /skip to content/i }),
    ).toBeFocused();
  });

  test("mobile navigation opens and exposes the auth links", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // Located by aria-controls rather than by name: the accessible name flips
    // between "Open menu" and "Close menu", so a name-based locator stops
    // matching the moment the button does its job.
    const toggle = page.locator('button[aria-controls="mobile-nav"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Clicking before hydration silently does nothing, so retry until the
    // menu actually opens rather than asserting on a single click.
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }).toPass({ timeout: 15_000 });

    const nav = page.locator("#mobile-nav");
    await expect(nav.getByRole("link", { name: /^sign in$/i })).toBeVisible();
  });

  test("legal and company pages are reachable from the footer", async ({
    page,
  }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    for (const name of [/privacy policy/i, /terms of service/i]) {
      await expect(footer.getByRole("link", { name })).toBeVisible();
    }
  });
});

test.describe("health endpoint", () => {
  test("reports configuration without leaking any value", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.configured.supabase).toBe("boolean");

    // Booleans only: a secret must never appear in a diagnostic endpoint.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/eyJ|sb_secret|sk_(test|live)_|whsec_/);
  });
});

/**
 * These assert what a visitor can actually SEE, not the HTTP status.
 *
 * Both routes ship a loading.tsx, so Next streams the response and commits
 * 200 before the lookup resolves; the not-found UI arrives in a later chunk.
 * The security property that matters is that no other tenant's data is ever
 * rendered, and that is what is checked here.
 */
test.describe("public routes that must not leak data", () => {
  test("an unknown store slug shows nothing belonging to anyone", async ({
    page,
  }) => {
    await page.goto("/store/definitely-not-a-real-shop-xyz");

    // Wait for the streamed body to settle before reading it.
    await expect(page.getByText(/loading catalogue/i)).toHaveCount(0);

    await expect(
      page.getByRole("heading", { name: /catalogue is not available/i }),
    ).toBeVisible();

    // A private catalogue and a missing one must look identical, so this page
    // cannot be used to discover which slugs exist.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/₹\s?\d/);
    expect(body).not.toMatch(/in stock|out of stock|made to order/i);
  });

  test("an unguessable invoice token reveals no invoice", async ({ page }) => {
    await page.goto("/invoice/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const body = await page.locator("body").innerText();
    // Either "not found", or - when SUPABASE_SECRET_KEY is absent - an honest
    // "not available right now". Both are failing closed.
    expect(body).toMatch(/could not|not found|not available/i);
    expect(body).not.toMatch(/₹\s?\d/);
    expect(body).not.toMatch(/order #/i);
  });

  test("a malformed invoice token is rejected, not crashed on", async ({
    page,
  }) => {
    await page.goto("/invoice/not-a-token");

    await expect(
      page.getByRole("heading", { name: /invoice link is not valid/i }),
    ).toBeVisible();

    // A stack trace or Postgres error must never reach a public page.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/at Object\.|PGRST|SQLSTATE|stack/i);
  });
});
