import { expect, test } from "@playwright/test";

import {
  deleteTestUser,
  provisionTestUser,
  type TestUser,
} from "./support/test-user";

/**
 * The platform admin area must be invisible to everyone who is not an
 * operator - including a perfectly legitimate signed-in seller.
 *
 * It answers 404 rather than 403 on purpose: a "forbidden" page confirms the
 * area exists and is worth attacking, while a 404 tells a curious seller
 * nothing at all.
 */

const ADMIN_ROUTES = ["/admin", "/admin/sellers"];

test.describe("anonymous visitors", () => {
  for (const route of ADMIN_ROUTES) {
    test(`${route} does not exist for a signed-out visitor`, async ({
      page,
    }) => {
      const response = await page.goto(route);

      // Either 404 outright, or bounced to sign-in - never the admin UI.
      const status = response?.status() ?? 0;
      expect([404, 200]).toContain(status);

      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/operations/i);
      expect(body).not.toMatch(/businesses/i);
    });
  }
});

test.describe("a signed-in seller", () => {
  let user: TestUser | null = null;
  let skipReason = "";

  test.beforeAll(async () => {
    const result = await provisionTestUser("Admin Probe");
    if (result.ok) user = result.user;
    else skipReason = result.reason;
  });

  test.afterAll(async () => {
    if (user?.source === "admin-api") await deleteTestUser(user.email);
  });

  test.beforeEach(() => {
    test.skip(user === null, `No confirmed test account: ${skipReason}`);
  });

  for (const route of ADMIN_ROUTES) {
    test(`cannot reach ${route}`, async ({ page }) => {
      await page.goto("/login");
      await page.getByRole("textbox", { name: /^email$/i }).fill(user!.email);
      await page
        .getByRole("textbox", { name: /^password$/i })
        .fill(user!.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });

      await page.goto(route);

      const body = await page.locator("body").innerText();
      // The seller is authenticated, so this is the real test: being logged in
      // must not be enough.
      expect(body).toMatch(/could not find|not found|404/i);
      expect(body).not.toMatch(/operations/i);
    });
  }
});
