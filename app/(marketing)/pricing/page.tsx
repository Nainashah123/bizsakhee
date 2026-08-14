import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";

import { formatPlanPrice } from "@/components/billing/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatLimit,
  ORDERED_PLANS,
  type LimitKey,
  type Plan,
} from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "BizSakhi pricing: a free plan to start, and paid plans from ₹299 a month as your customer list, catalogue and team grow.",
};

/**
 * Public pricing page.
 *
 * Every number comes from `lib/plans`, so the page cannot drift from what the
 * app actually enforces. No testimonials, no invented customer counts, no
 * countdowns - just the plans and what they include.
 */

const LIMIT_ROWS: { key: LimitKey; label: string }[] = [
  { key: "seats", label: "Team seats" },
  { key: "contacts", label: "Customers" },
  { key: "products", label: "Products" },
  { key: "ai_generations", label: "AI drafts a month" },
];

const FEATURE_ROWS: { label: string; test: (plan: Plan) => boolean }[] = [
  {
    label: "Orders, payments and follow-ups",
    test: () => true,
  },
  {
    label: "Shareable product catalogue",
    test: () => true,
  },
  {
    label: "Automations",
    test: (plan) => plan.features.includes("automations"),
  },
  {
    label: "WhatsApp and Instagram channels",
    test: (plan) => plan.features.includes("channel_integrations"),
  },
  {
    label: "Priority support",
    test: (plan) => plan.features.includes("priority_support"),
  },
];

function yearlyLine(plan: Plan): string | null {
  if (plan.annualPriceMinor <= 0) return null;
  const saving = plan.monthlyPriceMinor * 12 - plan.annualPriceMinor;
  const price = formatPlanPrice(plan.annualPriceMinor, plan.currency);
  if (saving <= 0) return `Or ${price} a year.`;
  return `Or ${price} a year — you save ${formatPlanPrice(saving, plan.currency)}.`;
}

function YesNo({ included }: { included: boolean }) {
  return included ? (
    <>
      <Check className="mx-auto size-4 text-success" aria-hidden="true" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">Not included</span>
    </>
  );
}

export default function PricingPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-secondary/70 via-background to-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
          <h1 className="max-w-3xl text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl">
            Start free. Pay only when your business outgrows it.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
            Every plan has the whole product in it — customers, orders,
            payments, follow-ups and your catalogue. What changes is how many
            customers, products and AI drafts you get, and how many people can
            work with you.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Prices are in Indian rupees, per workspace.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ORDERED_PLANS.map((plan) => {
            const yearly = yearlyLine(plan);
            return (
              <Card key={plan.key} className="h-full">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{plan.name}</CardTitle>
                    {plan.key === "free" ? (
                      <Badge variant="secondary">No card needed</Badge>
                    ) : null}
                  </div>
                  <p className="text-3xl font-bold tracking-tight">
                    {formatPlanPrice(plan.monthlyPriceMinor, plan.currency)}
                    {plan.key === "free" ? null : (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / month
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {plan.tagline}
                  </p>
                </CardHeader>

                <CardContent className="flex h-full flex-col gap-4">
                  <ul className="space-y-2">
                    {plan.highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="flex items-start gap-2 text-sm"
                      >
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-success"
                          aria-hidden="true"
                        />
                        {highlight}
                      </li>
                    ))}
                  </ul>

                  {yearly ? (
                    <p className="text-xs text-muted-foreground">{yearly}</p>
                  ) : null}

                  <div className="mt-auto">
                    <Button asChild size="lg" className="w-full">
                      <Link href="/signup">Start free</Link>
                    </Button>
                    {plan.key === "free" ? null : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Create your workspace first, then move to {plan.name}{" "}
                        from the billing screen whenever you are ready.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-bold tracking-tight">
          What each plan includes
        </h2>
        <div className="mt-6 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              Limits and features for every BizSakhi plan
            </caption>
            <thead>
              <tr className="border-b bg-secondary/40">
                <th scope="col" className="p-3 text-left font-semibold">
                  &nbsp;
                </th>
                {ORDERED_PLANS.map((plan) => (
                  <th
                    key={plan.key}
                    scope="col"
                    className="p-3 text-center font-semibold"
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LIMIT_ROWS.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <th scope="row" className="p-3 text-left font-medium">
                    {row.label}
                  </th>
                  {ORDERED_PLANS.map((plan) => (
                    <td
                      key={plan.key}
                      className="p-3 text-center text-muted-foreground tabular-nums"
                    >
                      {formatLimit(plan.limits[row.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {FEATURE_ROWS.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <th scope="row" className="p-3 text-left font-medium">
                    {row.label}
                  </th>
                  {ORDERED_PLANS.map((plan) => (
                    <td key={plan.key} className="p-3 text-center">
                      <YesNo included={row.test(plan)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-y bg-secondary/40">
        <div className="mx-auto w-full max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight">
            Questions people actually ask
          </h2>
          <dl className="mt-6 space-y-6">
            <div>
              <dt className="font-semibold">Do I need a card to start?</dt>
              <dd className="mt-1 text-muted-foreground">
                No. The Free plan needs an email address and nothing else.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">
                What happens when I reach a limit?
              </dt>
              <dd className="mt-1 text-muted-foreground">
                Everything you already have keeps working — you can open, edit,
                and export all of it. You simply cannot add new records past the
                limit until you upgrade or archive some. Archived customers and
                products do not count towards your plan.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">What if I cancel or downgrade?</dt>
              <dd className="mt-1 text-muted-foreground">
                You stay on the paid plan until the end of the period you have
                paid for, then move to Free. Nothing is deleted — your
                customers, orders and products are all still there.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Can I pay yearly?</dt>
              <dd className="mt-1 text-muted-foreground">
                Yes, on every paid plan, at the yearly price shown on each card
                above.
              </dd>
            </div>
          </dl>

          <Button asChild size="lg" className="mt-8 h-12">
            <Link href="/signup">Create your free workspace</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
