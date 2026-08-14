import { formatBasisPoints, formatDate } from "@/components/orders/formatting";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type PaymentMethodValue,
  type PaymentStatusValue,
} from "@/lib/validation/orders";
import { cn } from "@/lib/utils";

/**
 * The invoice itself.
 *
 * One presentational component serves both the owner's printable copy and the
 * public shared link, so what a customer sees is exactly what was printed.
 * It renders no interactive controls and reads no data of its own.
 */

export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type InvoicePayment = {
  id: string;
  amountMinor: number;
  method: PaymentMethodValue;
  reference: string | null;
  paidAt: string;
};

export type InvoiceData = {
  orderNumber: number;
  issuedOn: string;
  dueOn: string | null;
  currency: CurrencyCode;
  paymentStatus: PaymentStatusValue;
  sellerName: string;
  sellerCity?: string | null;
  sellerWhatsApp?: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCity?: string | null;
  items: InvoiceLine[];
  payments: InvoicePayment[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxBasisPoints: number;
  shippingMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  outstandingMinor: number;
  notes: string | null;
};

export function InvoiceDocument({
  invoice,
  className,
}: {
  invoice: InvoiceData;
  className?: string;
}) {
  const money = (minor: number) => formatMoney(minor, invoice.currency);

  return (
    <article
      className={cn(
        "mx-auto w-full max-w-3xl bg-card p-6 text-card-foreground sm:p-8",
        className,
      )}
      aria-label={`Invoice for order number ${invoice.orderNumber}`}
    >
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Invoice</h1>
          <p className="text-sm text-muted-foreground">
            Order #{invoice.orderNumber}
          </p>
        </div>
        <dl className="text-sm sm:text-right">
          <div className="flex gap-2 sm:justify-end">
            <dt className="text-muted-foreground">Issued</dt>
            <dd>{formatDate(invoice.issuedOn)}</dd>
          </div>
          {invoice.dueOn ? (
            <div className="flex gap-2 sm:justify-end">
              <dt className="text-muted-foreground">Due</dt>
              <dd>{formatDate(invoice.dueOn)}</dd>
            </div>
          ) : null}
          <div className="flex gap-2 sm:justify-end">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium">
              {PAYMENT_STATUS_LABELS[invoice.paymentStatus]}
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6 border-b py-6 sm:grid-cols-2">
        <section>
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            From
          </h2>
          <p className="mt-1 font-medium">{invoice.sellerName || "Seller"}</p>
          {invoice.sellerCity ? (
            <p className="text-sm text-muted-foreground">
              {invoice.sellerCity}
            </p>
          ) : null}
          {invoice.sellerWhatsApp ? (
            <p className="text-sm text-muted-foreground">
              WhatsApp {invoice.sellerWhatsApp}
            </p>
          ) : null}
        </section>

        <section>
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Billed to
          </h2>
          <p className="mt-1 font-medium">
            {invoice.customerName ?? "Walk-in customer"}
          </p>
          {invoice.customerPhone ? (
            <p className="text-sm text-muted-foreground">
              {invoice.customerPhone}
            </p>
          ) : null}
          {invoice.customerEmail ? (
            <p className="text-sm text-muted-foreground">
              {invoice.customerEmail}
            </p>
          ) : null}
          {invoice.customerCity ? (
            <p className="text-sm text-muted-foreground">
              {invoice.customerCity}
            </p>
          ) : null}
        </section>
      </div>

      <div className="overflow-x-auto py-6">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">
            Items on order number {invoice.orderNumber}
          </caption>
          <thead>
            <tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="py-2 pr-3 font-medium">
                Item
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Price
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-b last:border-b-0">
                <td className="py-2.5 pr-3">{item.description}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {item.quantity}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {money(item.unitPriceMinor)}
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {money(item.lineTotalMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end border-t pt-4">
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          <TotalRow label="Subtotal" value={money(invoice.subtotalMinor)} />
          {invoice.discountMinor > 0 ? (
            <TotalRow
              label="Discount"
              value={`- ${money(invoice.discountMinor)}`}
            />
          ) : null}
          {invoice.taxBasisPoints > 0 ? (
            <TotalRow
              label={`Tax (${formatBasisPoints(invoice.taxBasisPoints)})`}
              value={money(invoice.taxMinor)}
            />
          ) : null}
          {invoice.shippingMinor > 0 ? (
            <TotalRow label="Delivery" value={money(invoice.shippingMinor)} />
          ) : null}
          <div className="flex items-baseline justify-between border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(invoice.totalMinor)}</dd>
          </div>
          <TotalRow label="Paid" value={money(invoice.amountPaidMinor)} />
          <div className="flex items-baseline justify-between border-t pt-2 font-semibold">
            <dt>Outstanding</dt>
            <dd className="tabular-nums">{money(invoice.outstandingMinor)}</dd>
          </div>
        </dl>
      </div>

      {invoice.payments.length > 0 ? (
        <section className="border-t pt-4">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Payments received
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {invoice.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {formatDate(payment.paidAt)} -{" "}
                  {PAYMENT_METHOD_LABELS[payment.method]}
                  {payment.reference ? ` - ${payment.reference}` : ""}
                </span>
                <span className="tabular-nums">
                  {money(payment.amountMinor)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invoice.notes ? (
        <section className="mt-4 border-t pt-4">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Notes
          </h2>
          <p className="mt-1 text-sm whitespace-pre-line">{invoice.notes}</p>
        </section>
      ) : null}

      <footer className="mt-6 border-t pt-4 text-xs text-muted-foreground">
        <p>Amounts are in {invoice.currency}. Thank you for your business.</p>
      </footer>
    </article>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
