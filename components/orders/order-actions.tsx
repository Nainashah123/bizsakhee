"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { BellRing, Ban } from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cancelOrderAction,
  createPaymentReminderAction,
  updateOrderStatusAction,
  type OrderActionState,
} from "@/features/orders/actions";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type OrderStatusValue,
} from "@/lib/validation/orders";

const EMPTY_STATE: OrderActionState = {};

/** Surfaces a successful action as a toast so the page itself stays calm. */
function useActionToast(state: OrderActionState, onDone?: () => void) {
  useEffect(() => {
    if (state.message) {
      toast.success(state.message);
      onDone?.();
    }
  }, [state.message, onDone]);
}

export function OrderStatusForm({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatusValue;
}) {
  const [state, submit] = useActionState(updateOrderStatusAction, EMPTY_STATE);
  const fieldId = useId();
  useActionToast(state);

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <FormAlert variant="error">{state.error}</FormAlert>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-status`}>Order status</Label>
        <Select name="status" defaultValue={status}>
          <SelectTrigger id={`${fieldId}-status`} className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {ORDER_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SubmitButton className="sm:w-auto sm:min-w-40">
        Update status
      </SubmitButton>
    </form>
  );
}

export function CancelOrderButton({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit] = useActionState(cancelOrderAction, EMPTY_STATE);
  useActionToast(state, () => setOpen(false));

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="lg">
          <Ban aria-hidden="true" />
          Cancel order
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel order #{orderNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            The order stays in your records with a Cancelled status, and no more
            payments can be recorded against it. Payments already recorded are
            kept.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <FormAlert variant="error">{state.error}</FormAlert>

        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <form action={submit}>
            <input type="hidden" name="orderId" value={orderId} />
            <SubmitButton variant="destructive" className="sm:w-auto">
              Yes, cancel it
            </SubmitButton>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PaymentReminderButton({ orderId }: { orderId: string }) {
  const [state, submit] = useActionState(
    createPaymentReminderAction,
    EMPTY_STATE,
  );
  useActionToast(state);

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <FormAlert variant="error">{state.error}</FormAlert>
      <SubmitButton variant="outline" className="sm:w-auto">
        <BellRing aria-hidden="true" />
        Add payment reminder
      </SubmitButton>
      <p className="text-xs text-muted-foreground">
        Creates a follow-up task with the amount still due, so it shows up in
        Follow-ups.
      </p>
    </form>
  );
}
