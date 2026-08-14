"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCapability } from "@/lib/auth/session";
import { absoluteUrl } from "@/lib/env";
import { isCurrencyCode } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import {
  createOrderSchema,
  orderIdSchema,
  paymentReminderSchema,
  recordPaymentSchema,
  updateOrderSchema,
  updateOrderStatusSchema,
} from "@/lib/validation/orders";
import {
  createOrder,
  createPaymentReminderTask,
  issueInvoiceShareToken,
  recordPayment,
  revokeInvoiceShareToken,
  setOrderStatus,
  updateOrder,
  type OrderWriteContext,
} from "@/features/orders/service";
import { ok, type Result } from "@/lib/result";

/**
 * Order Server Actions.
 *
 * Each one starts with `requireCapability("orders.write")`, which resolves the
 * workspace from the session - the workspace id is never read from the form -
 * and confirms the member's role in the same step.
 *
 * These run on the Node.js runtime (the default for Server Actions), which
 * `lib/tokens.ts` requires for `node:crypto`.
 */

export type OrderActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  /** Present only on the single response that issues a new share link. */
  shareUrl?: string;
};

function failure(result: {
  error: { message: string; fieldErrors?: Record<string, string[]> };
}): OrderActionState {
  return {
    error: result.error.message,
    fieldErrors: result.error.fieldErrors,
  };
}

async function writeContext(): Promise<Result<{ context: OrderWriteContext }>> {
  const authorized = await requireCapability("orders.write");
  if (!authorized.ok) return authorized;

  const { user, workspace } = authorized.data;
  const supabase = await createClient();

  return ok({
    context: {
      supabase,
      workspaceId: workspace.id,
      userId: user.id,
      currency: isCurrencyCode(workspace.currency) ? workspace.currency : "INR",
    },
  });
}

function revalidateOrder(orderId?: string) {
  revalidatePath("/dashboard/orders");
  if (orderId) revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard");
}

export async function createOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(createOrderSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const created = await createOrder(authorized.data.context, parsed.data);
  if (!created.ok) return failure(created);

  revalidateOrder(created.data.id);
  redirect(`/dashboard/orders/${created.data.id}`);
}

export async function updateOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(updateOrderSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const updated = await updateOrder(authorized.data.context, parsed.data);
  if (!updated.ok) return failure(updated);

  revalidateOrder(updated.data.id);
  return { message: "Order updated." };
}

export async function updateOrderStatusAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(updateOrderStatusSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const updated = await setOrderStatus(
    authorized.data.context,
    parsed.data.orderId,
    parsed.data.status,
  );
  if (!updated.ok) return failure(updated);

  revalidateOrder(parsed.data.orderId);
  return { message: "Status updated." };
}

export async function cancelOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(orderIdSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const cancelled = await setOrderStatus(
    authorized.data.context,
    parsed.data.orderId,
    "cancelled",
  );
  if (!cancelled.ok) return failure(cancelled);

  revalidateOrder(parsed.data.orderId);
  return { message: "Order cancelled." };
}

export async function recordPaymentAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(recordPaymentSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const recorded = await recordPayment(authorized.data.context, parsed.data);
  if (!recorded.ok) return failure(recorded);

  revalidateOrder(parsed.data.orderId);
  return {
    message:
      recorded.data.outstandingMinor === 0
        ? "Payment recorded. This order is now fully paid."
        : "Payment recorded.",
  };
}

export async function generateInvoiceLinkAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(orderIdSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const issued = await issueInvoiceShareToken(
    authorized.data.context,
    parsed.data.orderId,
  );
  if (!issued.ok) return failure(issued);

  revalidateOrder(parsed.data.orderId);
  // The raw token is returned once, here. Only its hash was stored.
  return {
    message: "Share link ready. Copy it now - it is shown only once.",
    shareUrl: absoluteUrl(`/invoice/${issued.data.token}`),
  };
}

export async function revokeInvoiceLinkAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(orderIdSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const revoked = await revokeInvoiceShareToken(
    authorized.data.context,
    parsed.data.orderId,
  );
  if (!revoked.ok) return failure(revoked);

  revalidateOrder(parsed.data.orderId);
  return { message: "Share link revoked. The old link no longer opens." };
}

export async function createPaymentReminderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const authorized = await writeContext();
  if (!authorized.ok) return failure(authorized);

  const parsed = parseFormData(paymentReminderSchema, formData);
  if (!parsed.ok) return failure(parsed);

  const created = await createPaymentReminderTask(
    authorized.data.context,
    parsed.data.orderId,
    parsed.data.dueOn,
  );
  if (!created.ok) return failure(created);

  revalidateOrder(parsed.data.orderId);
  revalidatePath("/dashboard/tasks");
  return { message: `Follow-up created: ${created.data.title}` };
}
