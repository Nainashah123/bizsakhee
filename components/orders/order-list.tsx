import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { formatDate, isOverdue } from "@/components/orders/formatting";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/orders/status-badges";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrderListPage } from "@/features/orders/queries";
import { formatMoney } from "@/lib/money";

/**
 * The order list: cards on a phone, a table from `lg`. Both render the same
 * rows, so nothing is only reachable on one screen size.
 */
export function OrderList({
  page,
  query,
}: {
  page: OrderListPage;
  /** Current filters as a query string, so paging keeps them. */
  query: string;
}) {
  const hrefForPage = (target: number) => {
    const params = new URLSearchParams(query);
    if (target > 1) params.set("page", String(target));
    else params.delete("page");
    const search = params.toString();
    return search ? `/dashboard/orders?${search}` : "/dashboard/orders";
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-3 lg:hidden">
        {page.rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/dashboard/orders/${row.id}`}
              className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    #{row.orderNumber}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {row.contactName ?? "No customer"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(row.createdAt)} - {row.itemCount} item
                    {row.itemCount === 1 ? "" : "s"}
                  </p>
                </div>
                <ChevronRight
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={row.status} />
                <PaymentStatusBadge status={row.paymentStatus} />
                {isOverdue(row.dueOn, row.outstandingMinor) ? (
                  <span className="text-xs font-medium text-destructive">
                    Overdue since {formatDate(row.dueOn)}
                  </span>
                ) : null}
              </div>

              <dl className="mt-3 flex items-end justify-between gap-3 border-t pt-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatMoney(row.totalMinor, row.currency)}
                  </dd>
                </div>
                <div className="text-right">
                  <dt className="text-xs text-muted-foreground">Outstanding</dt>
                  <dd
                    className={
                      row.outstandingMinor > 0
                        ? "font-semibold text-destructive tabular-nums"
                        : "font-semibold text-success-foreground tabular-nums"
                    }
                  >
                    {formatMoney(row.outstandingMinor, row.currency)}
                  </dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Order</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Date</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Payment</TableHead>
              <TableHead scope="col" className="text-right">
                Total
              </TableHead>
              <TableHead scope="col" className="text-right">
                Outstanding
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/orders/${row.id}`}
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    #{row.orderNumber}
                  </Link>
                </TableCell>
                <TableCell>{row.contactName ?? "No customer"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(row.createdAt)}
                </TableCell>
                <TableCell>
                  <OrderStatusBadge status={row.status} />
                </TableCell>
                <TableCell>
                  <PaymentStatusBadge status={row.paymentStatus} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.totalMinor, row.currency)}
                </TableCell>
                <TableCell
                  className={
                    row.outstandingMinor > 0
                      ? "text-right font-medium text-destructive tabular-nums"
                      : "text-right text-muted-foreground tabular-nums"
                  }
                >
                  {formatMoney(row.outstandingMinor, row.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {page.pageCount > 1 ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Order list pages"
        >
          <Button
            asChild={page.page > 1}
            variant="outline"
            size="lg"
            disabled={page.page <= 1}
          >
            {page.page > 1 ? (
              <Link href={hrefForPage(page.page - 1)} rel="prev">
                Previous
              </Link>
            ) : (
              <span>Previous</span>
            )}
          </Button>

          <p className="text-sm text-muted-foreground" aria-live="polite">
            Page {page.page} of {page.pageCount}
          </p>

          <Button
            asChild={page.page < page.pageCount}
            variant="outline"
            size="lg"
            disabled={page.page >= page.pageCount}
          >
            {page.page < page.pageCount ? (
              <Link href={hrefForPage(page.page + 1)} rel="next">
                Next
              </Link>
            ) : (
              <span>Next</span>
            )}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
