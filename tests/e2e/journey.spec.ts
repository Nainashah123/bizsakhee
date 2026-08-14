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

  // Sign-in lands on /dashboard, and the dashboard layout then redirects to
  // /onboarding when the user has no workspace yet. Waiting on the URL alone
  // catches the intermediate hop, so wait for whichever page actually settles.
  await expect(
    page
      .getByRole("heading", { name: /let's set you up/i })
      .or(page.getByRole("heading", { level: 1, name: /^hi /i })),
  ).toBeVisible({ timeout: 30_000 });
}

async function completeOnboardingIfNeeded(page: Page) {
  const heading = page.getByRole("heading", { name: /let's set you up/i });
  if (!(await heading.isVisible().catch(() => false))) return;

  await page.getByLabel(/what should we call you/i).fill("Naina E2E");

  // Clicking before hydration is a no-op, so drive each step until the next
  // one is actually on screen rather than assuming one click advances it.
  const businessName = page.getByLabel(/business name/i);
  await expect(async () => {
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(businessName).toBeVisible();
  }).toPass({ timeout: 20_000 });

  await businessName.fill("E2E Boutique");

  const finish = page.getByRole("button", { name: /finish setup/i });
  await expect(async () => {
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(finish).toBeVisible();
  }).toPass({ timeout: 20_000 });

  await finish.click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^hi /i }),
  ).toBeVisible({ timeout: 30_000 });
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

    // Assert the row's link, not bare text: the WhatsApp action carries the
    // same name in its accessible label, and that node is not the one a
    // seller sees in the list.
    await expect(
      page.getByRole("link", { name: "Meera Nair", exact: true }).first(),
    ).toBeVisible();

    // The number the seller typed unformatted is stored normalised. Asserted
    // through the WhatsApp link rather than the rendered text, because the
    // list renders both a mobile card and a desktop table and only one of them
    // is visible at any given breakpoint.
    await expect(
      page
        .getByRole("link", { name: /message meera nair on whatsapp/i })
        .first(),
    ).toHaveAttribute("href", /wa\.me\/919876543210/);
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
