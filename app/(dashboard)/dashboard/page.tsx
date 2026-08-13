import type { Metadata } from "next";
import {
  AlertTriangle,
  CalendarClock,
  IndianRupee,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { getDashboardSummary } from "@/features/dashboard/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { formatMoney, isCurrencyCode } from "@/lib/money";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const summary = await getDashboardSummary(workspace.id);

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";
  const money = (minor: number) => formatMoney(minor, currency);

  const firstName =
    ((user.user_metadata?.full_name as string | undefined) ?? "").split(
      " ",
    )[0] || "there";

  const isEmpty =
    summary.contactCount === 0 &&
    summary.ordersThisMonth === 0 &&
    summary.openTaskCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hi {firstName}</h1>
        <p className="text-sm text-muted-foreground">
          Here is where your business stands today.
        </p>
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Start with one customer</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Nothing here yet. Add the customer you spoke to most recently -
              once one contact, one order or one follow-up exists, this page
              starts tracking it for you.
            </p>
            <p className="text-sm text-muted-foreground">
              Customers, products and orders arrive in the next release; this
              overview already reads live workspace data, so the numbers below
              are real, not samples.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="money-heading" className="space-y-3">
        <h2 id="money-heading" className="text-sm font-semibold">
          Money
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Sales this month"
            value={money(summary.salesThisMonthMinor)}
            hint={`${summary.ordersThisMonth} order${summary.ordersThisMonth === 1 ? "" : "s"}`}
            icon={IndianRupee}
            tone="success"
          />
          <StatCard
            label="Still to collect"
            value={money(summary.outstandingMinor)}
            hint="Unpaid and part-paid orders"
            icon={Wallet}
            tone={summary.outstandingMinor > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Orders this month"
            value={String(summary.ordersThisMonth)}
            icon={Receipt}
          />
        </div>
      </section>

      <section aria-labelledby="people-heading" className="space-y-3">
        <h2 id="people-heading" className="text-sm font-semibold">
          People and follow-ups
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Customers"
            value={String(summary.contactCount)}
            hint={`${summary.newEnquiriesThisWeek} added this week`}
            icon={Users}
          />
          <StatCard
            label="Due today"
            value={String(summary.dueTodayCount)}
            icon={CalendarClock}
          />
          <StatCard
            label="Overdue"
            value={String(summary.overdueTaskCount)}
            hint={
              summary.overdueTaskCount > 0 ? "Needs attention" : "All clear"
            }
            icon={AlertTriangle}
            tone={summary.overdueTaskCount > 0 ? "destructive" : "success"}
          />
          <StatCard
            label="Open follow-ups"
            value={String(summary.openTaskCount)}
            icon={CalendarClock}
          />
        </div>
      </section>
    </div>
  );
}
