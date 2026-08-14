import { Check } from "lucide-react";

import { CheckoutButton } from "@/components/billing/billing-buttons";
import { formatPlanPrice } from "@/components/billing/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ORDERED_PLANS, type Plan, type PlanKey } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * The plan ladder with upgrade buttons.
 *
 * Upgrade prompts name the plan and what it raises. There are no countdowns, no
 * "only today" scarcity and no pre-ticked upsells: a customer either needs the
 * higher limit or they do not.
 */

export type PurchasableIntervals = Record<
  PlanKey,
  { month: boolean; year: boolean }
>;

function annualSaving(plan: Plan): string | null {
  const saving = plan.monthlyPriceMinor * 12 - plan.annualPriceMinor;
  if (saving <= 0) return null;
  return `${formatPlanPrice(plan.annualPriceMinor, plan.currency)} a year, saving ${formatPlanPrice(
    saving,
    plan.currency,
  )}`;
}

function PlanCard({
  plan,
  isCurrent,
  isUpgrade,
  showCheckout,
  purchasable,
}: {
  plan: Plan;
  isCurrent: boolean;
  isUpgrade: boolean;
  showCheckout: boolean;
  purchasable: { month: boolean; year: boolean };
}) {
  const annual = annualSaving(plan);

  return (
    <Card
      className={cn(
        "h-full",
        isCurrent && "border-primary ring-1 ring-primary",
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{plan.name}</CardTitle>
          {isCurrent ? <Badge variant="secondary">Current plan</Badge> : null}
        </div>
        <p className="text-2xl font-bold tracking-tight">
          {formatPlanPrice(plan.monthlyPriceMinor, plan.currency)}
          <span className="text-sm font-normal text-muted-foreground">
            {plan.key === "free" ? "" : " / month"}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{plan.tagline}</p>
      </CardHeader>

      <CardContent className="flex h-full flex-col gap-4">
        <ul className="space-y-2">
          {plan.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-2 text-sm">
              <Check
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden="true"
              />
              {highlight}
            </li>
          ))}
        </ul>

        {annual ? (
          <p className="text-xs text-muted-foreground">Yearly: {annual}.</p>
        ) : null}

        <div className="mt-auto space-y-2">
          {isCurrent ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
              This is your plan today.
            </p>
          ) : null}

          {!isCurrent && showCheckout && isUpgrade && purchasable.month ? (
            <CheckoutButton
              plan={plan.key}
              interval="month"
              label={`Upgrade to ${plan.name}`}
            />
          ) : null}

          {!isCurrent && showCheckout && isUpgrade && purchasable.year ? (
            <CheckoutButton
              plan={plan.key}
              interval="year"
              label="Upgrade yearly"
              variant="outline"
            />
          ) : null}

          {!isCurrent && showCheckout && isUpgrade && !purchasable.month ? (
            <p className="text-xs text-muted-foreground">
              This plan has no price configured in this deployment yet, so it
              cannot be bought here.
            </p>
          ) : null}

          {!isCurrent && !isUpgrade ? (
            <p className="text-xs text-muted-foreground">
              Moving down a plan is done in the billing portal. Nothing is
              deleted - you keep everything you have already created.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function PlanComparison({
  currentPlan,
  showCheckout,
  purchasable,
}: {
  currentPlan: PlanKey;
  /** False for non-owners and when Stripe is not configured: read-only cards. */
  showCheckout: boolean;
  purchasable: PurchasableIntervals;
}) {
  const currentIndex = ORDERED_PLANS.findIndex(
    (plan) => plan.key === currentPlan,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {ORDERED_PLANS.map((plan, index) => (
        <PlanCard
          key={plan.key}
          plan={plan}
          isCurrent={plan.key === currentPlan}
          isUpgrade={index > currentIndex}
          showCheckout={showCheckout}
          purchasable={purchasable[plan.key]}
        />
      ))}
    </div>
  );
}
