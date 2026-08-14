import type { Metadata } from "next";
import { AlertTriangle, Receipt } from "lucide-react";

import { OrderFiltersBar } from "@/components/orders/order-filters";
import { OrderFormDialog } from "@/components/orders/order-form";
import { OrderList } from "@/components/orders/order-list";
import { Card, CardContent } from "@/components/ui/card";
import { getOrderFormOptions, listOrders } from "@/features/orders/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { isCurrencyCode } from "@/lib/money";
import { can } from "@/lib/permissions";
import {
  hasActiveOrderFilters,
  parseOrderFilters,
} from "@/lib/validation/orders";

export const metadata: Metadata = { title: "Orders" };

type SearchParams = Record<string, string | string[] | undefined>;

function queryStringFor(params: SearchParams): string {
  const search = new URLSearchParams();
  for (const key of ["q", "status", "payment", "from", "to"] as const) {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  return search.toString();
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { workspace } = await requireWorkspace();
  const params = await searchParams;

  const filters = parseOrderFilters(params);
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  const [result, options] = await Promise.all([
    listOrders(workspace.id, filters, page),
    getOrderFormOptions(workspace.id),
  ]);

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";
  const canWrite = can(workspace.role, "orders.write");
  const filtered = hasActiveOrderFilters(filters);

  const newOrderButton = canWrite ? (
    <OrderFormDialog
      mode="create"
      contacts={options.contacts}
      products={options.products}
      currency={currency}
      triggerLabel="New order"
    />
  ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            What you sold, what is paid, and what is still to collect.
          </p>
        </div>
        {newOrderButton}
      </div>

      <OrderFiltersBar filters={filters} />

      {!result.ok ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              We could not load your orders
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              {result.error.message}
            </p>
            <p className="text-sm text-muted-foreground">
              Reload the page to try again. If it keeps happening, your
              connection to the database may be down.
            </p>
          </CardContent>
        </Card>
      ) : result.data.rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-center gap-2 text-lg font-semibold">
              <Receipt className="size-5" aria-hidden="true" />
              {filtered ? "No orders match those filters" : "No orders yet"}
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              {filtered
                ? "Try a wider date range, or clear the filters to see every order."
                : "Create an order the next time someone buys from you. BizSakhi works out the total, tracks the payment and gives you an invoice to send."}
            </p>
            {filtered ? null : newOrderButton}
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.data.totalCount} order
            {result.data.totalCount === 1 ? "" : "s"}
            {filtered ? " match your filters" : ""}
          </p>
          <OrderList page={result.data} query={queryStringFor(params)} />
        </>
      )}
    </div>
  );
}
