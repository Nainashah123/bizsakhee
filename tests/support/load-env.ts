import { readFileSync } from "node:fs";

/**
 * Loads .env.local into process.env.
 *
 * Vitest and Playwright each run in their own Node process and, unlike
 * `next dev`, neither reads .env.local. Without this the integration and
 * journey suites cannot see SUPABASE_SECRET_KEY, skip themselves, and report a
 * green run that covered nothing - the worst possible failure mode for a test
 * suite.
 *
 * A value already present in the environment always wins, so CI can override.
 */
export function loadEnvLocal(file = ".env.local"): void {
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
