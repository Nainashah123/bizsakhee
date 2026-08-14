import { CalendarClock, CircleAlert, Info } from "lucide-react";

import { ManageBillingButton } from "@/components/billing/billing-buttons";
import {
  formatBillingDate,
  formatPlanPrice,
} from "@/components/billing/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Plan } from "@/lib/plans";
import type { SubscriptionSnapshot } from "@/lib/plans/entitlements";
import type { SubscriptionStatus } from "@/lib/supabase/database.types";

/**
 * What the workspace is on right now.
 *
 * `plan` is the plan actually in force, resolved on the server from the
 * subscription status - a cancelled subscription shows Free, never the plan the
 * customer used to pay for.
 */

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  canceled: "Cancelled",
  incomplete: "Payment incomplete",
  incomplete_expired: "Payment expired",
  unpaid: "Unpaid",
  paused: "Paused",
};

function statusVariant(
  status: SubscriptionStatus,
): "default" | "secondary" | "destructive" {
  if (status === "active" || status === "trialing") return "default";
  if (status === "past_due" || status === "unpaid") return "destructive";
  return "secondary";
}

export function CurrentPlanCard({
  plan,
  subscription,
  canManage,
  billingConfigured,
}: {
  plan: Plan;
  subscription: SubscriptionSnapshot | null;
  canManage: boolean;
  billingConfigured: boolean;
}) {
  const isAnnual = subscription?.interval === "year";
  const price = isAnnual
    ? `${formatPlanPrice(plan.annualPriceMinor, plan.currency)} a year`
    : `${formatPlanPrice(plan.monthlyPriceMinor, plan.currency)} a month`;

  const periodEnd = formatBillingDate(subscription?.currentPeriodEnd ?? null);
  const trialEnd = formatBillingDate(subscription?.trialEndsAt ?? null);

  const pastDue = subscription?.status === "past_due";
  const canOpenPortal =
    canManage && billingConfigured && Boolean(subscription?.hasStripeCustomer);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {plan.name} plan
              {subscription ? (
                <Badge variant={statusVariant(subscription.status)}>
                  {STATUS_LABELS[subscription.status]}
                </Badge>
              ) : null}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{plan.tagline}</p>
          </div>
          <p className="text-sm font-semibold">
            {plan.key === "free" ? "Free" : price}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {pastDue ? (
          <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="flex items-start gap-2 text-sm font-medium text-destructive">
              <CircleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              Your last payment did not go through.
            </p>
            <p className="text-sm text-muted-foreground">
              Your workspace still works while the card is retried. Update your
              payment method to keep the {plan.name} plan - if the retries run
              out, the workspace moves to Free and nothing is deleted.
            </p>
            {canOpenPortal ? (
              <ManageBillingButton
                label="Update payment method"
                variant="default"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {canManage
                  ? "Payments are not configured on this deployment, so the payment portal cannot be opened here."
                  : "Ask the workspace owner to update the payment method."}
              </p>
            )}
          </div>
        ) : null}

        {subscription?.cancelAtPeriodEnd && periodEnd ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Cancelled. You keep {plan.name} until {periodEnd}, then this
            workspace moves to Free. Your customers, orders and products stay -
            you just cannot add more than the Free plan allows.
          </p>
        ) : null}

        {!subscription?.cancelAtPeriodEnd && periodEnd ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
            Renews on {periodEnd}
            {subscription?.interval
              ? ` (billed ${subscription.interval === "year" ? "yearly" : "monthly"})`
              : ""}
          </p>
        ) : null}

        {subscription?.status === "trialing" && trialEnd ? (
          <p className="text-sm text-muted-foreground">
            Your trial ends on {trialEnd}.
          </p>
        ) : null}

        {!subscription ? (
          <p className="text-sm text-muted-foreground">
            You are on the free plan. There is no card on file and nothing to
            cancel.
          </p>
        ) : null}

        {canOpenPortal && !pastDue ? (
          <ManageBillingButton label="Manage billing and invoices" />
        ) : null}

        {!canManage ? (
          <p className="border-t pt-4 text-sm text-muted-foreground">
            Only the workspace owner can change the plan or payment details. You
            can see the plan and usage here.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
