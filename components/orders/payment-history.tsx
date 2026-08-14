import { formatDateTime } from "@/components/orders/formatting";
import type { PaymentView } from "@/features/orders/queries";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/orders";

/** Every payment recorded against the order, newest first. */
export function PaymentHistory({
  payments,
  currency,
}: {
  payments: PaymentView[];
  currency: CurrencyCode;
}) {
  if (payments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No payment recorded yet. Use the form above the moment money arrives, so
        the outstanding amount stays true.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {payments.map((payment) => (
        <li
          key={payment.id}
          className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {PAYMENT_METHOD_LABELS[payment.method]}
            </p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={payment.paidAt}>
                {formatDateTime(payment.paidAt)}
              </time>
              {payment.reference ? ` - ${payment.reference}` : ""}
            </p>
          </div>
          <p className="shrink-0 font-semibold text-success-foreground tabular-nums">
            {formatMoney(payment.amountMinor, currency)}
          </p>
        </li>
      ))}
    </ul>
  );
}
