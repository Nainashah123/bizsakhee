import Link from "next/link";
import { Building2, CreditCard, Sparkles, TrendingUp } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listSellers, summarise } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { ORDERED_PLANS } from "@/lib/plans";

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();

  const result = await listSellers();

  if (!result.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Operations are unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {result.error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const sellers = result.data;
  const metrics = summarise(sellers);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Every business running on BizSakhi.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Businesses"
          value={String(metrics.totalSellers)}
          hint={`${metrics.newThisWeek} joined this week`}
          icon={Building2}
        />
        <StatCard
          label="Paying"
          value={String(metrics.payingSellers)}
          hint={
            metrics.totalSellers > 0
              ? `${Math.round((metrics.payingSellers / metrics.totalSellers) * 100)}% of sellers`
              : "No sellers yet"
          }
          icon={CreditCard}
          tone={metrics.payingSellers > 0 ? "success" : "default"}
        />
        <StatCard
          label="Actually using it"
          value={String(metrics.sellersWithActivity)}
          hint="Added a customer, product or order"
          icon={Sparkles}
        />
        <StatCard
          label="New this month"
          value={String(metrics.newThisMonth)}
          icon={TrendingUp}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ORDERED_PLANS.map((plan) => {
            const count = metrics.planBreakdown[plan.key];
            const share =
              metrics.totalSellers > 0
                ? Math.round((count / metrics.totalSellers) * 100)
                : 0;

            return (
              <div key={plan.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{plan.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {count} {count === 1 ? "business" : "businesses"}
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${plan.name}: ${share}% of businesses`}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {metrics.totalSellers === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="font-semibold">Nobody has signed up yet</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Share the sign-up link with your first seller. She creates her own
              account - there is nothing for you to set up per business.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Button asChild variant="outline">
          <Link href="/admin/sellers">See all businesses</Link>
        </Button>
      )}
    </div>
  );
}
