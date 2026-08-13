import "server-only";

import { createClient } from "@/lib/supabase/server";

export type DashboardSummary = {
  contactCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  dueTodayCount: number;
  ordersThisMonth: number;
  salesThisMonthMinor: number;
  outstandingMinor: number;
  newEnquiriesThisWeek: number;
};

function startOfMonthIso(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

function endOfTodayIso(now: Date): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  ).toISOString();
}

/**
 * Workspace metrics for the overview page.
 *
 * Every query is filtered by workspace_id even though RLS already restricts
 * rows: defence in depth, and it keeps the query plans indexed.
 */
export async function getDashboardSummary(
  workspaceId: string,
  now: Date = new Date(),
): Promise<DashboardSummary> {
  const supabase = await createClient();

  const monthStart = startOfMonthIso(now);
  const todayEnd = endOfTodayIso(now);
  const nowIso = now.toISOString();
  const weekAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    contacts,
    openTasks,
    overdueTasks,
    dueToday,
    monthOrders,
    unpaidOrders,
    newContacts,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "open"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .lt("due_at", nowIso),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .gte("due_at", nowIso)
      .lte("due_at", todayEnd),
    supabase
      .from("orders")
      .select("total_minor")
      .eq("workspace_id", workspaceId)
      .neq("status", "cancelled")
      .gte("created_at", monthStart),
    supabase
      .from("orders")
      .select("total_minor, amount_paid_minor")
      .eq("workspace_id", workspaceId)
      .neq("status", "cancelled")
      .in("payment_status", ["unpaid", "partially_paid"]),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", weekAgo),
  ]);

  const salesThisMonthMinor = (monthOrders.data ?? []).reduce(
    (total, order) => total + Number(order.total_minor ?? 0),
    0,
  );

  const outstandingMinor = (unpaidOrders.data ?? []).reduce(
    (total, order) =>
      total +
      Math.max(
        0,
        Number(order.total_minor ?? 0) - Number(order.amount_paid_minor ?? 0),
      ),
    0,
  );

  return {
    contactCount: contacts.count ?? 0,
    openTaskCount: openTasks.count ?? 0,
    overdueTaskCount: overdueTasks.count ?? 0,
    dueTodayCount: dueToday.count ?? 0,
    ordersThisMonth: monthOrders.data?.length ?? 0,
    salesThisMonthMinor,
    outstandingMinor,
    newEnquiriesThisWeek: newContacts.count ?? 0,
  };
}
