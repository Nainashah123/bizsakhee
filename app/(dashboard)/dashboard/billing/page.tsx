import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { OverLimitNotice } from "@/components/billing/over-limit-notice";
import {
  PlanComparison,
  type PurchasableIntervals,
} from "@/components/billing/plan-comparison";
import { UsageMeters } from "@/components/billing/usage-meters";
import {
  SetupRequired,
  type SetupStep,
} from "@/components/setup/setup-required";
import { getBillingOverview } from "@/features/billing/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PLAN_KEYS } from "@/lib/plans";
import { billingConfigState, isPurchasable } from "@/lib/stripe/prices";

export const metadata: Metadata = { title: "Plan & billing" };

/**
 * Billing screen.
 *
 * Every decision here is made on the server: the workspace and the role come
 * from `requireWorkspace()`, the plan comes from the `subscriptions` row, and
 * the usage comes from count queries. The browser is never asked what plan it
 * is on, and the checkout route enforces the same capability again.
 */

const ENV_HELP: Record<string, string> = {
  STRIPE_SECRET_KEY:
    "Secret API key from the Stripe dashboard (sk_live_… / sk_test_…)",
  STRIPE_WEBHOOK_SECRET:
    "Signing secret for the /api/stripe/webhook endpoint (whsec_…)",
  STRIPE_STARTER_MONTHLY_PRICE_ID:
    "Price id for Starter, billed monthly (price_…)",
  STRIPE_GROWTH_MONTHLY_PRICE_ID:
    "Price id for Growth, billed monthly (price_…)",
  STRIPE_PRO_MONTHLY_PRICE_ID: "Price id for Pro, billed monthly (price_…)",
};

function setupSteps(missing: string[]): SetupStep[] {
  return [
    {
      label: "Create the products and prices in Stripe",
      detail: "dashboard.stripe.com - one price per plan you want to sell",
      done: false,
    },
    ...missing.map((variable) => ({
      label: `Set ${variable}`,
      detail: ENV_HELP[variable] ?? "Add this to .env.local and to Vercel",
      done: false,
    })),
    {
      label: "Restart the app so the new variables are read",
      detail: "pnpm dev",
      done: false,
    },
  ];
}

export default async function BillingPage() {
  const { workspace } = await requireWorkspace();

  // Server-resolved role. The UI hides controls to match, but this value - not
  // anything from the browser - is what decides.
  const canManage = can(workspace.role, "billing.manage");

  const overview = await getBillingOverview(workspace.id);
  const billing = billingConfigState();

  const purchasable = Object.fromEntries(
    PLAN_KEYS.map((key) => [
      key,
      { month: isPurchasable(key, "month"), year: isPurchasable(key, "year") },
    ]),
  ) as PurchasableIntervals;

  const header = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Plan &amp; billing</h1>
      <p className="text-sm text-muted-foreground">
        What {workspace.name} is on today, how much of it you are using, and
        what each plan changes.
      </p>
    </div>
  );

  if (overview.failed) {
    return (
      <div className="max-w-3xl space-y-6">
        {header}
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
            <CircleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            We could not load your plan and usage.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing has changed about your subscription - this is a read that
            failed. Refresh the page to try again, and if it keeps happening let
            us know.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-2">
        <CurrentPlanCard
          plan={overview.plan}
          subscription={overview.subscription}
          canManage={canManage}
          billingConfigured={billing.configured}
        />
        <UsageMeters meters={overview.meters} period={overview.period} />
      </div>

      <OverLimitNotice blocked={overview.blocked} plan={overview.plan} />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Plans</h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Upgrade when you actually run out of room - the limits above tell you when."
              : "Only the workspace owner can change the plan. These are the limits each plan carries."}
          </p>
        </div>

        {canManage && !billing.configured ? (
          <SetupRequired
            title="Setup required: connect Stripe to sell plans"
            summary="Payments are not configured on this deployment, so checkout would fail. Nothing is broken with your workspace - these variables simply have not been set."
            steps={setupSteps(billing.missing)}
            docsPath="docs/deployment.md"
          />
        ) : null}

        <PlanComparison
          currentPlan={overview.plan.key}
          showCheckout={canManage && billing.configured}
          purchasable={purchasable}
        />
      </section>
    </div>
  );
}
