import { expect, test } from "@playwright/test";

/**
 * Stage 3: route protection.
 *
 * Every one of these runs without a signed-in user - that is the point. They
 * assert that the guard fires, not that a page renders.
 */

const PROTECTED_ROUTES = [
  "/dashboard",
  "/dashboard/contacts",
  "/dashboard/orders",
  "/dashboard/products",
  "/dashboard/tasks",
  "/dashboard/pipeline",
  "/dashboard/settings",
  "/onboarding",
];

test.describe("unauthenticated access", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to sign-in and remembers where you were going`, async ({
      page,
    }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);

      // The destination must survive so sign-in returns the user to it.
      const redirectTo = new URL(page.url()).searchParams.get("redirectTo");
      expect(redirectTo).toBe(route);
    });
  }

  test("the sign-in page never reveals whether an email exists", async ({
    page,
  }) => {
    await page.goto("/login");

    await page
      .getByRole("textbox", { name: /email/i })
      .fill("definitely-not-registered@bizsakhi-e2e.invalid");
    await page
      .getByRole("textbox", { name: /password/i })
      .fill("wrong-password-here");
    await page.getByRole("button", { name: /sign in/i }).click();

    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible();

    const message = (await alert.textContent()) ?? "";
    // "No account found" or "user not found" would confirm an address is free.
    expect(message).not.toMatch(
      /not found|no account|does not exist|unregistered/i,
    );
  });

  test("password reset gives the same answer for any address", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await page
      .getByRole("textbox", { name: /email/i })
      .fill("nobody@bizsakhi-e2e.invalid");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByRole("status")).toContainText(
      /if that email has an account/i,
    );
  });

  test("a reset link with no session explains itself instead of showing a dead form", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await expect(
      page.getByRole("link", { name: /request a new reset link/i }),
    ).toBeVisible();
  });
});

test.describe("open redirect protection", () => {
  const HOSTILE = [
    "https://evil.example.com",
    "//evil.example.com",
    "/\\evil.example.com",
  ];

  for (const target of HOSTILE) {
    test(`refuses to bounce to ${target}`, async ({ page }) => {
      await page.goto(`/login?redirectTo=${encodeURIComponent(target)}`);

      // Whatever the form does next, the hostile value must not survive into
      // the page as a usable destination.
      const hidden = page.locator('input[name="redirectTo"]').first();
      await expect(hidden).toHaveValue("/dashboard");
    });
  }
});
