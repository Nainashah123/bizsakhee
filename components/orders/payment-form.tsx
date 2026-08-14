"use client";

import { useActionState, useId, useState } from "react";
import { toast } from "sonner";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  recordPaymentAction,
  type OrderActionState,
} from "@/features/orders/actions";
import { formatMoney, toMajorUnits, type CurrencyCode } from "@/lib/money";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/validation/orders";

const EMPTY_STATE: OrderActionState = {};

/**
 * Records a full or partial payment.
 *
 * The amount is capped server-side at whatever is still outstanding; this form
 * only pre-fills that figure and explains the limit.
 */
export function PaymentForm({
  orderId,
  currency,
  outstandingMinor,
}: {
  orderId: string;
  currency: CurrencyCode;
  outstandingMinor: number;
}) {
  const [state, submit] = useActionState(recordPaymentAction, EMPTY_STATE);
  const fieldId = useId();
  const [amount, setAmount] = useState(
    String(toMajorUnits(outstandingMinor, currency)),
  );

  // Toasting is a side effect of a *new* action result, not of rendering, so
  // it is triggered by the state transition rather than by an effect that
  // would re-fire on every unrelated render.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.message) toast.success(state.message);
  }

  return (
    <form action={submit} className="space-y-4" noValidate>
      <input type="hidden" name="orderId" value={orderId} />
      <FormAlert variant="error">{state.error}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-amount`}>Amount received</Label>
          <Input
            id={`${fieldId}-amount`}
            name="amount"
            className="h-11"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-describedby={`${fieldId}-amount-hint ${fieldId}-amount-error`}
          />
          <p
            id={`${fieldId}-amount-hint`}
            className="text-xs text-muted-foreground"
          >
            {formatMoney(outstandingMinor, currency)} is still outstanding. A
            part payment is fine.
          </p>
          <FieldError
            id={`${fieldId}-amount-error`}
            messages={state.fieldErrors?.amount}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-method`}>How was it paid?</Label>
          <Select name="method" defaultValue="upi">
            <SelectTrigger id={`${fieldId}-method`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((method) => (
                <SelectItem key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-reference`}>Reference</Label>
          <Input
            id={`${fieldId}-reference`}
            name="reference"
            className="h-11"
            placeholder="UPI id, cheque number..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-paidAt`}>Received on</Label>
          <Input
            id={`${fieldId}-paidAt`}
            name="paidAt"
            type="datetime-local"
            className="h-11"
            aria-describedby={`${fieldId}-paidAt-hint ${fieldId}-paidAt-error`}
          />
          <p
            id={`${fieldId}-paidAt-hint`}
            className="text-sm text-muted-foreground"
          >
            Leave blank to record it as received now.
          </p>
          <FieldError
            id={`${fieldId}-paidAt-error`}
            messages={state.fieldErrors?.paidAt}
          />
        </div>
      </div>

      <SubmitButton className="sm:w-auto sm:min-w-44">
        Record payment
      </SubmitButton>
    </form>
  );
}
