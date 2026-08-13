import { z } from "zod";

/**
 * Environment validation.
 *
 * `clientEnv` holds only NEXT_PUBLIC_* values and is safe anywhere.
 * `serverEnv()` reads secrets and throws if imported from client code.
 *
 * Optional integrations (Stripe, AI, Meta) are validated lazily by their own
 * modules so the app still boots - and honestly reports "setup required" -
 * when a credential has not been provided yet.
 */

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,
});

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: optionalString,
  SUPABASE_DB_URL: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_STARTER_MONTHLY_PRICE_ID: optionalString,
  STRIPE_STARTER_ANNUAL_PRICE_ID: optionalString,
  STRIPE_GROWTH_MONTHLY_PRICE_ID: optionalString,
  STRIPE_GROWTH_ANNUAL_PRICE_ID: optionalString,
  STRIPE_PRO_MONTHLY_PRICE_ID: optionalString,
  STRIPE_PRO_ANNUAL_PRICE_ID: optionalString,

  AI_PROVIDER: z.enum(["anthropic", "vercel-gateway", "mock"]).default("mock"),
  AI_MODEL: z.string().trim().default("claude-sonnet-5"),
  ANTHROPIC_API_KEY: optionalString,
  AI_GATEWAY_API_KEY: optionalString,

  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_VERIFY_TOKEN: optionalString,
  META_REDIRECT_URI: optionalString,
  INTEGRATION_ENCRYPTION_KEY: optionalString,

  CRON_SECRET: optionalString,
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function format(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Next.js inlines NEXT_PUBLIC_* only for literal `process.env.X` reads, so the
 * keys must be spelled out rather than looked up dynamically.
 */
const rawClientEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
};

let cachedClientEnv: ClientEnv | undefined;

export function clientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;
  const parsed = clientSchema.safeParse(rawClientEnv);
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration:\n${format(parsed.error)}\n` +
        "Copy .env.example to .env.local and fill in the Supabase values.",
    );
  }
  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}

let cachedServerEnv: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must never be called from client code.");
  }
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment configuration:\n${format(parsed.error)}`,
    );
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/** Absolute URL helper that always uses the configured app origin. */
export function absoluteUrl(path = "/"): string {
  const base = clientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Reset caches. Test-only. */
export function __resetEnvCacheForTests(): void {
  cachedClientEnv = undefined;
  cachedServerEnv = undefined;
}
