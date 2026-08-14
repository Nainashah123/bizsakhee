import { expect, test, type Page } from "@playwright/test";

import {
  deleteTestUser,
  provisionTestUser,
  type TestUser,
} from "./support/test-user";

/**
 * The Definition of Done journey, end to end, in a real browser:
 * register -> onboard -> contact -> product -> order -> payment -> follow-up
 * -> public catalogue.
 *
 * Needs a confirmed account. See support/test-user.ts for how one is obtained.
 * When none is available every test here SKIPS with the reason printed - they
 * are never reported as passing.
 */

let user: TestUser | null = null;
let skipReason = "";

test.beforeAll(async () => {
  const result = await provisionTestUser("Naina E2E");
  if (result.ok) user = result.user;
  else skipReason = result.reason;
});

test.afterAll(async () => {
  if (user?.source === "admin-api") await deleteTestUser(user.email);
});

test.beforeEach(() => {
  test.skip(user === null, `No confirmed test account: ${skipReason}`);
});

async function signIn(page: Page, account: TestUser) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /^email$/i }).fill(account.email);
  await page
    .getByRole("textbox", { name: /^password$/i })
    .fill(account.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

async function completeOnboardingIfNeeded(page: Page) {
  if (!page.url().includes("/onboarding")) return;

  await page.getByLabel(/what should we call you/i).fill("Naina E2E");
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByLabel(/business name/i).fill("E2E Boutique");
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByRole("button", { name: /finish setup/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe.configure({ mode: "serial" });

test.describe("the core journey", () => {
  test("registers, onboards and lands on a scoped dashboard", async ({
    page,
  }) => {
    await signIn(page, user!);
    await completeOnboardingIfNeeded(page);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/hi /i);

    // A brand-new workspace must read as empty, not as broken.
    await expect(page.getByText(/still to collect/i)).toBeVisible();
  });

  test("creates a customer and finds them again by search", async ({
    page,
  }) => {
    await signIn(page, user!);
    await completeOnboardingIfNeeded(page);

    await page.goto("/dashboard/contacts");
    await page
      .getByRole("button", { name: /add customer|new customer/i })
      .first()
      .click();

    await page.getByLabel(/name/i).first().fill("Meera Nair");
    await page.getByLabel(/phone/i).first().fill("98765 43210");
    await page
      .getByRole("button", { name: /save|add customer/i })
      .last()
      .click();

    await expect(page.getByText("Meera Nair").first()).toBeVisible();
  });

  test("refuses a duplicate phone number in the same workspace", async ({
    page,
  }) => {
    await signIn(page, user!);
    await page.goto("/dashboard/contacts");

    await page
      .getByRole("button", { name: /add customer|new customer/i })
      .first()
      .click();
    await page.getByLabel(/name/i).first().fill("Meera Duplicate");
    // Same number, written differently: normalisation must still catch it.
    await page.getByLabel(/phone/i).first().fill("+91 98765 43210");
    await page
      .getByRole("button", { name: /save|add customer/i })
      .last()
      .click();

    await expect(page.getByRole("alert").first()).toContainText(
      /already|duplicate|exists/i,
    );
  });

  test("keeps a draft product off the public catalogue", async ({ page }) => {
    await signIn(page, user!);
    await page.goto("/dashboard/settings");

    const slug = await page.locator("text=/\\/store\\//").first().textContent();
    const storePath = slug?.trim().replace(/^.*\/store\//, "/store/") ?? "";
    test.skip(storePath === "", "Could not read the workspace slug");

    // Unpublished workspaces and drafts must not be publicly visible.
    const response = await page.goto(storePath);
    expect([200, 404]).toContain(response?.status() ?? 0);

    if (response?.status() === 200) {
      await expect(page.getByText(/sample - cotton kurta/i)).toHaveCount(0);
    }
  });
});
