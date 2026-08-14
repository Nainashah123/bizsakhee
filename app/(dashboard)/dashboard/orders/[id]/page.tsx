import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Mail, MapPin, Phone } from "lucide-react";

import { PrintInvoiceButton } from "@/components/invoice/print-invoice-button";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { InvoicePrintStyles } from "@/components/invoice/print-styles";
import { formatDate, isOverdue } from "@/components/orders/formatting";
import {
  CancelOrderButton,
  OrderStatusForm,
  PaymentReminderButton,
} from "@/components/orders/order-actions";
import { OrderFormDialog } from "@/components/orders/order-form";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { PaymentForm } from "@/components/orders/payment-form";
import { PaymentHistory } from "@/components/orders/payment-history";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/components/orders/status-badges";
import { ShareInvoicePanel } from "@/components/orders/share-invoice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildOrderTimeline,
  getOrderDetail,
  getOrderFormOptions,
} from "@/features/orders/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { formatMoney, toMajorUnits } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * One order, end to end: what was sold, what it came to, what has been paid,
 * and everything that has happened since.
 *
 * The workspace is resolved from the session - never from the URL - and the id
 * in the path is only ever used as a filter *within* that workspace, so a
 * guessed id from another workspace resolves to nothing.
 */

type PageProps = { params: Promise<{ id: string }> };

/**
 * `cache` dedupes the read between `generateMetadata` and the render, so the
 * page costs one round of queries rather than two.
 */
const loadOrder = cache(async (workspaceId: string, orderId: string) =>
  getOrderDetail(workspaceId, orderId),
);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { workspace } = await requireWorkspace();
  const { id } = await params;

  const result = await loadOrder(workspace.id, id);
  if (!result.ok) return { title: "Order" };

  return { title: `Order #${result.data.orderNumber}` };
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { workspace } = await requireWorkspace();
  const { id } = await params;

  const result = await loadOrder(workspace.id, id);
  if (!result.ok) {
    if (result.error.code === "not_found") notFound();

    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" className="-ml-2 h-9">
          <Link href="/dashboard/orders">
            <ArrowLeft aria-hidden="true" />
            All orders
          </Link>
        </Button>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              We could not load this order
            </h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              {result.error.message}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const order = result.data;
  const canWrite = can(workspace.role, "orders.write");
  const cancelled = order.status === "cancelled";
  const settled = order.outstandingMinor === 0;
  const overdue = isOverdue(order.dueOn, order.outstandingMinor);

  const supabase = await createClient();
  const [{ data: business }, options] = await Promise.all([
    supabase
      .from("business_profiles")
      .select("business_name, city, whatsapp_number")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    // Only needed for the editor, which is hidden without the capability.
    canWrite && !cancelled
      ? getOrderFormOptions(workspace.id)
      : Promise.resolve(null),
  ]);

  const timeline = buildOrderTimeline(order);

  return (
    <div className="space-y-6">
      <InvoicePrintStyles />

      <Button asChild variant="ghost" className="-ml-2 h-9">
        <Link href="/dashboard/orders">
          <ArrowLeft aria-hidden="true" />
          All orders
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Order #{order.orderNumber}
            </h1>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
          </div>

          <p className="text-sm text-muted-foreground">
            Placed{" "}
            <time dateTime={order.createdAt}>
              {formatDate(order.createdAt)}
            </time>
            {order.dueOn ? (
              <>
                {" - payment due "}
                <time dateTime={order.dueOn}>{formatDate(order.dueOn)}</time>
              </>
            ) : null}
          </p>

          {overdue ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              {formatMoney(order.outstandingMinor, order.currency)} is overdue.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PrintInvoiceButton className="h-10" />
          {options ? (
            <OrderFormDialog
              mode="edit"
              contacts={options.contacts}
              products={options.products}
              currency={order.currency}
              triggerLabel="Edit order"
              triggerVariant="outline"
              triggerClassName="h-10"
              defaults={{
                orderId: order.id,
                contactId: order.contact?.id ?? "",
                status: order.status,
                lines: order.items.map((item) => ({
                  key: item.id,
                  productId: item.productId,
                  description: item.description,
                  quantity: String(item.quantity),
                  unitPrice: String(
                    toMajorUnits(item.unitPriceMinor, order.currency),
                  ),
                })),
                discountType: "amount",
                discountValue:
                  order.discountMinor > 0
                    ? String(toMajorUnits(order.discountMinor, order.currency))
                    : "",
                taxBasisPoints: order.taxBasisPoints,
                shipping:
                  order.shippingMinor > 0
                    ? String(toMajorUnits(order.shippingMinor, order.currency))
                    : "",
                notes: order.notes ?? "",
                dueOn: order.dueOn ?? "",
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section aria-labelledby="invoice-heading">
            <h2 id="invoice-heading" className="sr-only">
              Invoice
            </h2>
            {/* The print stylesheet reveals exactly this element on paper. */}
            <div
              data-invoice-print
              className="overflow-hidden rounded-xl border bg-card"
            >
              <InvoiceDocument
                invoice={{
                  orderNumber: order.orderNumber,
                  issuedOn: order.createdAt,
                  dueOn: order.dueOn,
                  currency: order.currency,
                  paymentStatus: order.paymentStatus,
                  sellerName: business?.business_name ?? workspace.name,
                  sellerCity: business?.city ?? null,
                  sellerWhatsApp: business?.whatsapp_number ?? null,
                  customerName: order.contact?.fullName ?? null,
                  customerPhone: order.contact?.phoneDisplay ?? null,
                  customerEmail: order.contact?.email ?? null,
                  customerCity: order.contact?.city ?? null,
                  items: order.items,
                  payments: order.payments,
                  subtotalMinor: order.subtotalMinor,
                  discountMinor: order.discountMinor,
                  taxMinor: order.taxMinor,
                  taxBasisPoints: order.taxBasisPoints,
                  shippingMinor: order.shippingMinor,
                  totalMinor: order.totalMinor,
                  amountPaidMinor: order.amountPaidMinor,
                  outstandingMinor: order.outstandingMinor,
                  notes: order.notes,
                }}
              />
            </div>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <p className="text-sm text-muted-foreground">
                {formatMoney(order.amountPaidMinor, order.currency)} received of{" "}
                {formatMoney(order.totalMinor, order.currency)}.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {!canWrite ? null : cancelled ? (
                <p className="text-sm text-muted-foreground">
                  This order is cancelled, so no further payment can be recorded
                  against it. Payments already recorded are kept.
                </p>
              ) : settled ? (
                <p className="text-sm font-medium text-success-foreground">
                  This order is fully paid. Nothing is left to collect.
                </p>
              ) : (
                <PaymentForm
                  orderId={order.id}
                  currency={order.currency}
                  outstandingMinor={order.outstandingMinor}
                />
              )}

              <PaymentHistory
                payments={order.payments}
                currency={order.currency}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <p className="text-sm text-muted-foreground">
                Everything that has happened on this order, newest first.
              </p>
            </CardHeader>
            <CardContent>
              <OrderTimeline events={timeline} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.subtotalMinor, order.currency)}
                  </dd>
                </div>
                {order.discountMinor > 0 ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Discount</dt>
                    <dd className="tabular-nums">
                      - {formatMoney(order.discountMinor, order.currency)}
                    </dd>
                  </div>
                ) : null}
                {order.taxMinor > 0 ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="tabular-nums">
                      {formatMoney(order.taxMinor, order.currency)}
                    </dd>
                  </div>
                ) : null}
                {order.shippingMinor > 0 ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Delivery</dt>
                    <dd className="tabular-nums">
                      {formatMoney(order.shippingMinor, order.currency)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between gap-3 border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.totalMinor, order.currency)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="text-success-foreground tabular-nums">
                    {formatMoney(order.amountPaidMinor, order.currency)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-semibold">
                  <dt>Outstanding</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.outstandingMinor, order.currency)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.contact ? (
                <>
                  <p className="font-medium">{order.contact.fullName}</p>
                  <dl className="space-y-1 text-sm text-muted-foreground">
                    {order.contact.phoneDisplay ? (
                      <div className="flex items-center gap-1.5">
                        <dt className="sr-only">Phone</dt>
                        <Phone className="size-3.5" aria-hidden="true" />
                        <dd className="tabular-nums">
                          {order.contact.phoneDisplay}
                        </dd>
                      </div>
                    ) : null}
                    {order.contact.email ? (
                      <div className="flex items-center gap-1.5">
                        <dt className="sr-only">Email</dt>
                        <Mail className="size-3.5" aria-hidden="true" />
                        <dd className="truncate">{order.contact.email}</dd>
                      </div>
                    ) : null}
                    {order.contact.city ? (
                      <div className="flex items-center gap-1.5">
                        <dt className="sr-only">City</dt>
                        <MapPin className="size-3.5" aria-hidden="true" />
                        <dd>{order.contact.city}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <Button asChild variant="outline" className="h-10 w-full">
                    <Link href={`/dashboard/contacts/${order.contact.id}`}>
                      Open customer
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No customer is linked to this order. Edit the order to attach
                  one, so it shows up in their history.
                </p>
              )}
            </CardContent>
          </Card>

          {canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>Share the invoice</CardTitle>
              </CardHeader>
              <CardContent>
                <ShareInvoicePanel
                  orderId={order.id}
                  hasShareLink={order.hasShareLink}
                />
              </CardContent>
            </Card>
          ) : null}

          {canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>Manage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {cancelled ? (
                  <p className="text-sm text-muted-foreground">
                    This order is cancelled. Set it back to another status to
                    start working on it again.
                  </p>
                ) : null}

                <OrderStatusForm orderId={order.id} status={order.status} />

                {!cancelled && !settled ? (
                  <PaymentReminderButton orderId={order.id} />
                ) : null}

                {!cancelled ? (
                  <div className="border-t pt-4">
                    <CancelOrderButton
                      orderId={order.id}
                      orderNumber={order.orderNumber}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
