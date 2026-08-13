import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and configuration probe.
 *
 * Reports whether each integration is configured - never the values. A missing
 * credential is reported honestly as "not_configured" rather than hidden.
 */
export async function GET() {
  const configured = {
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SECRET_KEY),
    stripe: Boolean(
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
    ),
    ai:
      process.env.AI_PROVIDER === "anthropic"
        ? Boolean(process.env.ANTHROPIC_API_KEY)
        : process.env.AI_PROVIDER === "vercel-gateway"
          ? Boolean(process.env.AI_GATEWAY_API_KEY)
          : false,
    meta: Boolean(
      process.env.META_APP_ID &&
      process.env.META_APP_SECRET &&
      process.env.META_VERIFY_TOKEN,
    ),
    cron: Boolean(process.env.CRON_SECRET),
  };

  return NextResponse.json(
    {
      status: "ok",
      time: new Date().toISOString(),
      configured,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
