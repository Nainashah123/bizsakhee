import { expect, test } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * Collects CSP violations caused by OUR pages.
 *
 * Vercel injects its own preview feedback widget from vercel.live into preview
 * deployments. It is platform tooling, absent from production and from any
 * self-hosted deployment, and allow-listing vercel.live in the shipped policy
 * purely to silence a preview-only widget would weaken the real policy for
 * real users. So it is excluded here rather than permitted there.
 */
function collectCspViolations(page: import("@playwright/test").Page): string[] {
  const violations: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    const isCspError =
      /content security policy|refused to (load|execute|apply)/i.test(text);
    if (isCspError && !text.includes("vercel.live")) violations.push(text);
  });

  return violations;
}

/**
 * Stage 8: the security headers, and - more importantly - proof that they do
 * not break the app.
 *
 * A CSP that silently blocks your own scripts looks fine in a header dump and
 * is catastrophic in a browser, so these tests check both the policy and the
 * page that has to live under it.
 */

test.describe("security headers", () => {
  test("are present on a page response", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy"]).toBeTruthy();
  });

  test("the policy locks down the directives that matter", async ({
    request,
  }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");

    const script = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    expect(script).toContain("'self'");

    // 'unsafe-eval' is Turbopack's dev runtime only. Shipping it to real users
    // would let injected strings become executable code.
    if (!/localhost|127\.0\.0\.1/.test(baseURL)) {
      expect(script).not.toContain("'unsafe-eval'");
    }
  });

  test("never allows a wildcard script host", async ({ request }) => {
    const csp = (await request.get("/")).headers()[
      "content-security-policy"
    ] as string;

    const script = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    for (const source of script.split(/\s+/).filter(Boolean)) {
      expect(source, `unexpected wildcard: ${source}`).not.toBe("*");
      expect(source, `unexpected wildcard host: ${source}`).not.toMatch(
        /^[a-z]+:\/\/\*/,
      );
    }
  });

  test("connect-src names the Supabase origin rather than a wildcard", async ({
    request,
  }) => {
    const csp = (await request.get("/")).headers()[
      "content-security-policy"
    ] as string;

    const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? "";
    expect(connect).toContain("'self'");

    // No wildcard HOST. A port wildcard on the loopback HMR socket is fine and
    // only present in development; "https://*" or a bare "*" would not be.
    for (const source of connect.split(/\s+/).filter(Boolean)) {
      expect(source, `unexpected wildcard source: ${source}`).not.toBe("*");
      expect(source, `unexpected wildcard host: ${source}`).not.toMatch(
        /^[a-z]+:\/\/\*/,
      );
    }

    // The dev-only HMR origins must never be advertised to real browsers.
    if (process.env.NODE_ENV === "production") {
      expect(connect).not.toContain("ws://localhost");
    }
  });
});

test.describe("the app still works under the policy", () => {
  test("the homepage renders and hydrates with no CSP violation", async ({
    page,
  }) => {
    const violations = collectCspViolations(page);

    await page.goto("/");

    // Hydration is the real test: if the policy blocked a chunk, this button
    // exists in the markup but never responds.
    await page.setViewportSize({ width: 390, height: 844 });
    const toggle = page.locator('button[aria-controls="mobile-nav"]');
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }).toPass({ timeout: 15_000 });

    expect(violations, violations.join("\n")).toHaveLength(0);
  });

  test("the sign-in form works under the policy", async ({ page }) => {
    const violations = collectCspViolations(page);

    await page.goto("/login");
    await page
      .getByRole("textbox", { name: /email/i })
      .fill("someone@bizsakhi-e2e.invalid");
    await page
      .getByRole("textbox", { name: /password/i })
      .fill("not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    // A Server Action round-trip completing proves scripts ran.
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(violations, violations.join("\n")).toHaveLength(0);
  });
});
