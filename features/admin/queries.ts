import "server-only";

import { logger } from "@/lib/logger";
import { effectivePlan, type PlanKey } from "@/lib/plans";
import { err, ok, type Result } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Reads for the platform admin area.
 *
 * Everything here uses the service role, because the whole point is to see
 * across businesses that RLS otherwise keeps apart. Two rules hold throughout:
 *
 *  - No customer message bodies, ever. Sellers' customers did not agree to
 *    that, and running the business does not require it. Counts and status
 *    are enough to know who signed up, who is paying and who is stuck.
 *  - Counts come from head-only count queries rather than fetching rows, so
 *    a seller with 20,000 customers does not drag the page down.
 */

export type SellerSummary = {
  workspaceId: string;
  name: string;
  slug: string;
  city: string | null;
  category: string | null;
  ownerEmail: string;
  ownerName: string | null;
  plan: PlanKey;
  subscriptionStatus: string;
  createdAt: string;
  counts: { contacts: number; products: number; orders: number };
};

export type PlatformMetrics = {
  totalSellers: number;
  newThisWeek: number;
  newThisMonth: number;
  payingSellers: number;
  planBreakdown: Record<PlanKey, number>;
  sellersWithActivity: number;
};

type Client = ReturnType<typeof createAdminClient>;

async function countFor(
  client: Client,
  table: "contacts" | "products" | "orders",
  workspaceId: string,
): Promise<number> {
  const { count } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  return count ?? 0;
}

export async function listSellers(): Promise<Result<SellerSummary[]>> {
  let client: Client;
  try {
    client = createAdminClient();
  } catch {
    return err(
      "not_configured",
      "SUPABASE_SECRET_KEY is not set on this deployment, so the admin area has no way to read across businesses.",
    );
  }

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("id, name, slug, owner_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    logger.error("admin_list_workspaces_failed", { code: error.code });
    return err("unknown", "Could not load the seller list.");
  }
  if (!workspaces?.length) return ok([]);

  const ids = workspaces.map((workspace) => workspace.id);
  const ownerIds = [...new Set(workspaces.map((w) => w.owner_id))];

  // Queried separately rather than with an embedded select, because the
  // hand-written database types carry no relationship metadata.
  const [businessResult, subscriptionResult, profileResult] = await Promise.all(
    [
      client
        .from("business_profiles")
        .select("workspace_id, city, category")
        .in("workspace_id", ids),
      client
        .from("subscriptions")
        .select("workspace_id, plan, status")
        .in("workspace_id", ids),
      client.from("profiles").select("id, full_name").in("id", ownerIds),
    ],
  );

  const businessByWorkspace = new Map(
    (businessResult.data ?? []).map((row) => [row.workspace_id, row]),
  );
  const subscriptionByWorkspace = new Map(
    (subscriptionResult.data ?? []).map((row) => [row.workspace_id, row]),
  );
  const profileById = new Map(
    (profileResult.data ?? []).map((row) => [row.id, row]),
  );

  // auth.users is not exposed through PostgREST, so emails come from the
  // admin API.
  const emailByUserId = new Map<string, string>();
  try {
    const { data: users } = await client.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const user of users?.users ?? []) {
      if (user.email) emailByUserId.set(user.id, user.email);
    }
  } catch (error) {
    logger.warn("admin_list_users_failed", { error });
  }

  const sellers = await Promise.all(
    workspaces.map(async (workspace): Promise<SellerSummary> => {
      const [contacts, products, orders] = await Promise.all([
        countFor(client, "contacts", workspace.id),
        countFor(client, "products", workspace.id),
        countFor(client, "orders", workspace.id),
      ]);

      const subscription = subscriptionByWorkspace.get(workspace.id);
      const business = businessByWorkspace.get(workspace.id);

      return {
        workspaceId: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        city: business?.city ?? null,
        category: business?.category ?? null,
        ownerEmail: emailByUserId.get(workspace.owner_id) ?? "unknown",
        ownerName: profileById.get(workspace.owner_id)?.full_name ?? null,
        // effectivePlan, not the raw column: a cancelled subscription is Free
        // no matter what plan key is still stored on the row.
        plan: effectivePlan({
          plan: subscription?.plan,
          status: subscription?.status,
        }).key,
        subscriptionStatus: subscription?.status ?? "none",
        createdAt: workspace.created_at,
        counts: { contacts, products, orders },
      };
    }),
  );

  return ok(sellers);
}

export function summarise(sellers: readonly SellerSummary[]): PlatformMetrics {
  const now = Date.now();
  const week = now - 7 * 24 * 60 * 60 * 1000;
  const month = now - 30 * 24 * 60 * 60 * 1000;

  const planBreakdown: Record<PlanKey, number> = {
    free: 0,
    starter: 0,
    growth: 0,
    pro: 0,
  };

  let newThisWeek = 0;
  let newThisMonth = 0;
  let payingSellers = 0;
  let sellersWithActivity = 0;

  for (const seller of sellers) {
    planBreakdown[seller.plan] += 1;
    if (seller.plan !== "free") payingSellers += 1;

    const created = Date.parse(seller.createdAt);
    if (created >= week) newThisWeek += 1;
    if (created >= month) newThisMonth += 1;

    // "Activity" means she actually put something in, not that she signed up.
    if (
      seller.counts.contacts > 0 ||
      seller.counts.products > 0 ||
      seller.counts.orders > 0
    ) {
      sellersWithActivity += 1;
    }
  }

  return {
    totalSellers: sellers.length,
    newThisWeek,
    newThisMonth,
    payingSellers,
    planBreakdown,
    sellersWithActivity,
  };
}
