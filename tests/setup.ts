import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { loadEnvLocal } from "./support/load-env";

// Real credentials first: the integration suite needs them. The defaults below
// only fill what is genuinely absent, so unit tests still run with no .env.
loadEnvLocal();

// Deterministic defaults so unit tests never depend on a developer's .env.local.
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
process.env.AI_PROVIDER ??= "mock";

afterEach(() => {
  cleanup();
});
