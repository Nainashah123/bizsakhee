import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { formatMoney, isCurrencyCode, type CurrencyCode } from "@/lib/money";
import {
  computeOrderTotals,
  outstandingMinor,
  type OrderLineInput,
} from "@/lib/orders/totals";
import { err, ok, type Result } from "@/lib/result";
import type { Database } from "@/lib/supabase/database.types";
import { generateShareToken, hashShareToken } from "@/lib/tokens";
import type {
  CreateOrderInput,
  OrderItemInput,
  OrderStatusValue,
  RecordPaymentInput,
  UpdateOrderInput,
} from "@/lib/validation/orders";

/**
 * Order writes.
 *
 * Every amount written to the database is produced by `computeOrderTotals`
 * here on the server, from prices this module reads itself. The browser's
 * arithmetic is only ever a preview.
 */

type Client = SupabaseClient<Database>;

export type OrderWriteContext = {
  supabase: Client;
  workspaceId: string;
  userId: string;
  currency: CurrencyCode;
};

const GENERIC_WRITE_ERROR = "We could not save that. Please try again.";

function currencyOf(value: string): CurrencyCode {
  return isCurrencyCode(value) ? value : "INR";
}

/** Confirms the customer exists inside this workspace before it is referenced. */
async function assertContactInWorkspace(
  { supabase, workspaceId }: OrderWriteContext,
  contactId: string,
): Promise<Result<null>> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    logger.error("order_contact_check_failed", { code: error.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }
  if (!data) {
    return err("validation", "Pick a customer from your own contact list.", {
      contactId: ["That customer is not in this workspace."],
    });
  }
  return ok(null);
}

/**
 * Turns submitted rows into priced lines.
 *
 * A line that names a product takes its description and price from the product
 * row, so a tampered price in the payload is discarded. A custom line has no
 * server-side price, so its (validated, non-negative) amount is used as typed.
 */
async function resolveLines(
  { supabase, workspaceId }: OrderWriteContext,
  items: OrderItemInput[],
): Promise<Result<OrderLineInput[]>> {
  const productIds = [
    ...new Set(
      items.flatMap((item) => (item.productId ? [item.productId] : [])),
    ),
  ];

  const products: {
    id: string;
    name: string;
    price_minor: number;
    sale_price_minor: number | null;
  }[] = productIds.length
    ? ((
        await supabase
          .from("products")
          .select("id, name, price_minor, sale_price_minor")
          .eq("workspace_id", workspaceId)
          .in("id", productIds)
      ).data ?? [])
    : [];

  const productById = new Map(products.map((product) => [product.id, product]));

  const lines: OrderLineInput[] = [];
  for (const item of items) {
    if (!item.productId) {
      lines.push({
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: item.unitPrice,
        productId: null,
      });
      continue;
    }

    const product = productById.get(item.productId);
    if (!product) {
      return err(
        "validation",
        "One of the products on this order is no longer available. Remove it and try again.",
      );
    }

    lines.push({
      // Snapshotted, so a later product rename never rewrites history.
      description: product.name,
      quantity: item.quantity,
      unitPriceMinor: Number(product.sale_price_minor ?? product.price_minor),
      productId: product.id,
    });
  }

  return ok(lines);
}

type PricedOrder = ReturnType<typeof computeOrderTotals>;

function priceOrder(
  lines: OrderLineInput[],
  input: {
    discountMinor: number;
    discountBasisPoints: number;
    taxBasisPoints: number;
    shipping: number;
  },
): Result<PricedOrder> {
  try {
    return ok(
      computeOrderTotals({
        lines,
        discountMinor: input.discountMinor,
        discountBasisPoints: input.discountBasisPoints,
        taxBasisPoints: input.taxBasisPoints,
        shippingMinor: input.shipping,
      }),
    );
  } catch (error) {
    logger.warn("order_totals_rejected", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return err(
      "validation",
      "Those amounts do not add up. Check the quantities and prices.",
    );
  }
}

async function writeItems(
  { supabase, workspaceId }: OrderWriteContext,
  orderId: string,
  totals: PricedOrder,
): Promise<Result<null>> {
  const { error } = await supabase.from("order_items").insert(
    totals.lines.map((line, index) => ({
      workspace_id: workspaceId,
      order_id: orderId,
      product_id: line.productId,
      description: line.description,
      quantity: line.quantity,
      unit_price_minor: line.unitPriceMinor,
      line_total_minor: line.lineTotalMinor,
      position: index,
    })),
  );

  if (error) {
    logger.error("order_items_write_failed", { code: error.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }
  return ok(null);
}

export async function createOrder(
  context: OrderWriteContext,
  input: CreateOrderInput,
): Promise<Result<{ id: string; orderNumber: number }>> {
  const contactCheck = await assertContactInWorkspace(context, input.contactId);
  if (!contactCheck.ok) return contactCheck;

  const lines = await resolveLines(context, input.items);
  if (!lines.ok) return lines;

  const priced = priceOrder(lines.data, input);
  if (!priced.ok) return priced;
  const totals = priced.data;

  const { supabase, workspaceId, userId, currency } = context;

  // order_number is issued by the `orders_assign_number` trigger, so it is
  // deliberately absent from this insert.
  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      workspace_id: workspaceId,
      contact_id: input.contactId,
      status: input.status,
      currency,
      subtotal_minor: totals.subtotalMinor,
      discount_minor: totals.discountMinor,
      tax_minor: totals.taxMinor,
      tax_basis_points: totals.taxBasisPoints,
      shipping_minor: totals.shippingMinor,
      total_minor: totals.totalMinor,
      notes: input.notes,
      due_on: input.dueOn,
      created_by: userId,
    })
    .select("id, order_number")
    .single();

  if (error || !order) {
    logger.error("order_insert_failed", { code: error?.code });
    return err("unknown", "We could not create that order. Please try again.");
  }

  const items = await writeItems(context, order.id, totals);
  if (!items.ok) {
    // Nothing here is transactional, so an order without its lines is rolled
    // back by hand rather than left behind as a phantom.
    await supabase
      .from("orders")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", order.id);
    return items;
  }

  return ok({ id: order.id, orderNumber: order.order_number });
}

export async function updateOrder(
  context: OrderWriteContext,
  input: UpdateOrderInput,
): Promise<Result<{ id: string }>> {
  const { supabase, workspaceId } = context;

  const { data: existing, error: readError } = await supabase
    .from("orders")
    .select("id, status, fulfilled_at, cancelled_at")
    .eq("workspace_id", workspaceId)
    .eq("id", input.orderId)
    .maybeSingle();

  if (readError) {
    logger.error("order_update_read_failed", { code: readError.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }
  if (!existing) return err("not_found", "That order no longer exists.");
  if (existing.status === "cancelled") {
    return err(
      "conflict",
      "This order is cancelled. Reopen it before editing the items.",
    );
  }

  const contactCheck = await assertContactInWorkspace(context, input.contactId);
  if (!contactCheck.ok) return contactCheck;

  const lines = await resolveLines(context, input.items);
  if (!lines.ok) return lines;

  const priced = priceOrder(lines.data, input);
  if (!priced.ok) return priced;
  const totals = priced.data;

  const { error: deleteError } = await supabase
    .from("order_items")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("order_id", input.orderId);

  if (deleteError) {
    logger.error("order_items_clear_failed", { code: deleteError.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }

  const items = await writeItems(context, input.orderId, totals);
  if (!items.ok) return items;

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      contact_id: input.contactId,
      status: input.status,
      subtotal_minor: totals.subtotalMinor,
      discount_minor: totals.discountMinor,
      tax_minor: totals.taxMinor,
      tax_basis_points: totals.taxBasisPoints,
      shipping_minor: totals.shippingMinor,
      total_minor: totals.totalMinor,
      notes: input.notes,
      due_on: input.dueOn,
      ...milestoneTimestamps(input.status, existing),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", input.orderId);

  if (updateError) {
    logger.error("order_update_failed", { code: updateError.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }

  // The total moved, so the derived payment status has to be re-derived by the
  // same database function the payment trigger uses.
  await supabase.rpc("recalculate_order_payment", {
    target_order: input.orderId,
  });

  return ok({ id: input.orderId });
}

/**
 * Milestone timestamps track the first time an order reached a state and are
 * cleared when it leaves that state, so they never claim a delivery that was
 * undone.
 */
function milestoneTimestamps(
  status: OrderStatusValue,
  existing: { fulfilled_at: string | null; cancelled_at: string | null },
) {
  const now = new Date().toISOString();
  return {
    fulfilled_at:
      status === "fulfilled" ? (existing.fulfilled_at ?? now) : null,
    cancelled_at:
      status === "cancelled" ? (existing.cancelled_at ?? now) : null,
  };
}

export async function setOrderStatus(
  context: OrderWriteContext,
  orderId: string,
  status: OrderStatusValue,
): Promise<Result<{ status: OrderStatusValue }>> {
  const { supabase, workspaceId } = context;

  const { data: existing, error: readError } = await supabase
    .from("orders")
    .select("id, status, fulfilled_at, cancelled_at")
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    logger.error("order_status_read_failed", { code: readError.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }
  if (!existing) return err("not_found", "That order no longer exists.");
  if (existing.status === status) return ok({ status });

  const { error } = await supabase
    .from("orders")
    .update({ status, ...milestoneTimestamps(status, existing) })
    .eq("workspace_id", workspaceId)
    .eq("id", orderId);

  if (error) {
    logger.error("order_status_update_failed", { code: error.code });
    return err("unknown", "We could not change the status. Please try again.");
  }

  return ok({ status });
}

export type RecordedPayment = {
  paymentStatus: string;
  amountPaidMinor: number;
  outstandingMinor: number;
};

/**
 * Records a payment and then re-reads the order.
 *
 * `amount_paid_minor` and `payment_status` are maintained by the
 * `payments_recalculate` trigger, so they are read back from the database
 * rather than guessed here.
 */
export async function recordPayment(
  context: OrderWriteContext,
  input: RecordPaymentInput,
): Promise<Result<RecordedPayment>> {
  const { supabase, workspaceId, userId } = context;

  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, status, currency, total_minor, amount_paid_minor")
    .eq("workspace_id", workspaceId)
    .eq("id", input.orderId)
    .maybeSingle();

  if (readError) {
    logger.error("payment_order_read_failed", { code: readError.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }
  if (!order) return err("not_found", "That order no longer exists.");
  if (order.status === "cancelled") {
    return err(
      "conflict",
      "This order is cancelled, so a payment cannot be recorded against it.",
    );
  }

  const currency = currencyOf(order.currency);
  const outstanding = outstandingMinor(
    Number(order.total_minor),
    Number(order.amount_paid_minor),
  );

  if (outstanding <= 0) {
    return err("conflict", "This order is already fully paid.");
  }

  if (input.amount > outstanding) {
    return err(
      "validation",
      `That is more than the ${formatMoney(outstanding, currency)} still outstanding on this order.`,
      { amount: [`Enter ${formatMoney(outstanding, currency)} or less.`] },
    );
  }

  const { error: insertError } = await supabase.from("payments").insert({
    workspace_id: workspaceId,
    order_id: input.orderId,
    amount_minor: input.amount,
    currency,
    method: input.method,
    reference: input.reference,
    paid_at: input.paidAt,
    recorded_by: userId,
  });

  if (insertError) {
    logger.error("payment_insert_failed", { code: insertError.code });
    return err(
      "unknown",
      "We could not record that payment. Please try again.",
    );
  }

  const { data: updated } = await supabase
    .from("orders")
    .select("payment_status, amount_paid_minor, total_minor")
    .eq("workspace_id", workspaceId)
    .eq("id", input.orderId)
    .maybeSingle();

  return ok({
    paymentStatus: updated?.payment_status ?? "unpaid",
    amountPaidMinor: Number(updated?.amount_paid_minor ?? 0),
    outstandingMinor: outstandingMinor(
      Number(updated?.total_minor ?? 0),
      Number(updated?.amount_paid_minor ?? 0),
    ),
  });
}

/**
 * Issues a share token. The raw token is returned exactly once - only its
 * SHA-256 hash is persisted - so a lost link has to be regenerated.
 */
export async function issueInvoiceShareToken(
  { supabase, workspaceId }: OrderWriteContext,
  orderId: string,
): Promise<Result<{ token: string }>> {
  const token = generateShareToken();

  const { data, error } = await supabase
    .from("orders")
    .update({ invoice_token_hash: hashShareToken(token) })
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("invoice_token_issue_failed", { code: error.code });
    return err(
      "unknown",
      "We could not create a share link. Please try again.",
    );
  }
  if (!data) return err("not_found", "That order no longer exists.");

  return ok({ token });
}

export async function revokeInvoiceShareToken(
  { supabase, workspaceId }: OrderWriteContext,
  orderId: string,
): Promise<Result<null>> {
  const { data, error } = await supabase
    .from("orders")
    .update({ invoice_token_hash: null })
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("invoice_token_revoke_failed", { code: error.code });
    return err("unknown", "We could not revoke that link. Please try again.");
  }
  if (!data) return err("not_found", "That order no longer exists.");

  return ok(null);
}

/**
 * Creates a follow-up task for an unpaid order. The tasks module owns the UI;
 * this only inserts the row so the reminder shows up wherever tasks are shown.
 */
export async function createPaymentReminderTask(
  context: OrderWriteContext,
  orderId: string,
  dueOn: string | null,
): Promise<Result<{ taskId: string; title: string }>> {
  const { supabase, workspaceId, userId } = context;

  const { data: order, error: readError } = await supabase
    .from("orders")
    .select(
      "id, order_number, contact_id, currency, status, total_minor, amount_paid_minor, due_on",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    logger.error("reminder_order_read_failed", { code: readError.code });
    return err("unknown", GENERIC_WRITE_ERROR);
  }
  if (!order) return err("not_found", "That order no longer exists.");
  if (order.status === "cancelled") {
    return err("conflict", "This order is cancelled, so nothing is due.");
  }

  const outstanding = outstandingMinor(
    Number(order.total_minor),
    Number(order.amount_paid_minor),
  );
  if (outstanding <= 0) {
    return err("conflict", "This order is fully paid - no reminder needed.");
  }

  const { data: openTask } = await supabase
    .from("tasks")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("order_id", orderId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (openTask) {
    return err(
      "conflict",
      "A follow-up for this order is already open in Follow-ups.",
    );
  }

  const currency = currencyOf(order.currency);
  const title = `Collect ${formatMoney(outstanding, currency)} for order #${order.order_number}`;
  const dueDate = dueOn ?? order.due_on;
  const dueAt = dueDate
    ? new Date(`${dueDate}T09:00:00Z`).toISOString()
    : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      workspace_id: workspaceId,
      title,
      description: `Payment reminder for order #${order.order_number}.`,
      status: "open",
      priority: "high",
      due_at: dueAt,
      order_id: orderId,
      contact_id: order.contact_id,
      assigned_to: userId,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !task) {
    logger.error("reminder_task_insert_failed", { code: error?.code });
    return err(
      "unknown",
      "We could not create that reminder. Please try again.",
    );
  }

  return ok({ taskId: task.id, title });
}
