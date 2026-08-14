import "server-only";

import Stripe from "stripe";

import { serverEnv } from "@/lib/env";

/**
 * The Stripe SDK client.
 *
 * Stripe is an optional integration: a deployment without `STRIPE_SECRET_KEY`
 * must still boot and render an honest "Setup required" state rather than
 * crashing. So this returns `null` instead of throwing, and every caller is
 * forced by the type to deal with the unconfigured case.
 *
 * The client is built lazily and memoised: constructing it at module scope
 * would read the environment during a build that has no Stripe keys.
 */

/**
 * Pinned deliberately. `satisfies` makes an SDK upgrade that moves the latest
 * version a compile error rather than a silent behaviour change in production.
 */
export const STRIPE_API_VERSION = "2026-07-29.dahlia" satisfies NonNullable<
  Stripe.StripeConfig["apiVersion"]
>;

/** `undefined` = not resolved yet, `null` = resolved and not configured. */
let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;

  const secretKey = serverEnv().STRIPE_SECRET_KEY;
  if (!secretKey) {
    cached = null;
    return cached;
  }

  cached = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    // Vercel functions are short-lived; one automatic retry smooths over a
    // transient network blip without turning a checkout into a long hang.
    maxNetworkRetries: 1,
    timeout: 20_000,
    appInfo: {
      name: "BizSakhi",
      url: "https://bizsakhi.app",
    },
  });

  return cached;
}

/** True when a Stripe client can actually be constructed. */
export function isStripeConfigured(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

/** Reset the memoised client. Test-only. */
export function __resetStripeClientForTests(): void {
  cached = undefined;
}
