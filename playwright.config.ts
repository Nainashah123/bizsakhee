import { readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs in its own Node process, which - unlike `next dev` - does not
 * read .env.local. Without this the suite cannot see SUPABASE_SECRET_KEY and
 * silently skips every authenticated journey, reporting a green run that
 * covered nothing.
 *
 * A real value already in the environment always wins, so CI can override.
 */
function loadEnvLocal(file = ".env.local"): void {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split(String.fromCharCode(10))) {
    const line = rawLine.replace(String.fromCharCode(13), "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    // Strip one layer of matching quotes, the way dotenv does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

// Must match the origin `next dev` serves. Hitting 127.0.0.1 while the dev
// server considers only localhost same-origin makes Next block its own
// client chunks, so nothing hydrates and every interaction silently fails.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev --port 3000",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
