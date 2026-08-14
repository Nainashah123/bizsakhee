import "server-only";

import { logger } from "@/lib/logger";
import { isCurrencyCode, type CurrencyCode } from "@/lib/money";
import { outstandingMinor } from "@/lib/orders/totals";
import { err, ok, type Result } from "@/lib/result";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  hashShareToken,
  isShareTokenShape,
  verifyShareToken,
} from "@/lib/tokens";
import type {
  OrderFilters,
  OrderStatusValue,
  PaymentMethodValue,
  PaymentStatusValue,
} from "@/lib/validation/orders";

/**
 * Order reads.
 *
 * Two rules hold everywhere in this file:
 *   1. Every query is filtered by `workspace_id` as well as relying on RLS.
 *   2. No PostgREST embedded selects - related rows are fetched separately and
 *      joined in TypeScript, because the hand-written database types carry no
 *      relationship metadata.
 */

export const ORDERS_PAGE_SIZE = 25;

export type OrderListRow = {
  id: string;
  orderNumber: number;
  status: OrderStatusValue;
  paymentStatus: PaymentStatusValue;
  currency: CurrencyCode;
  totalMinor: number;
  amountPaidMinor: number;
  outstandingMinor: number;
  createdAt: string;
  dueOn: string | null;
  contactName: string | null;
  itemCount: number;
};

export type OrderListPage = {
  rows: OrderListRow[];
  totalCount: number;
  page: number;
  pageCount: number;
};

export type OrderItemView = {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  productId: string | null;
};

export type PaymentView = {
  id: string;
  amountMinor: number;
  method: PaymentMethodValue;
  reference: string | null;
  paidAt: string;
};

export type OrderContactView = {
  id: string;
  fullName: string;
  phoneDisplay: string | null;
  email: string | null;
  city: string | null;
};

export type OrderTaskView = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type OrderDetail = {
  id: string;
  orderNumber: number;
  status: OrderStatusValue;
  paymentStatus: PaymentStatusValue;
  currency: CurrencyCode;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxBasisPoints: number;
  shippingMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  outstandingMinor: number;
  notes: string | null;
  dueOn: string | null;
  hasShareLink: boolean;
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  contact: OrderContactView | null;
  items: OrderItemView[];
  payments: PaymentView[];
  tasks: OrderTaskView[];
};

export type ContactOption = { id: string; label: string; hint: string | null };

export type ProductOption = {
  id: string;
  name: string;
  priceMinor: number;
  currency: CurrencyCode;
};

export type OrderFormOptions = {
  contacts: ContactOption[];
  products: ProductOption[];
};

const ORDER_COLUMNS =
  "id, order_number, status, payment_status, currency, subtotal_minor, discount_minor, tax_minor, tax_basis_points, shipping_minor, total_minor, amount_paid_minor, notes, due_on, invoice_token_hash, fulfilled_at, cancelled_at, created_at, updated_at, contact_id";

/** Same columns plus the workspace id, needed to resolve the seller header. */
const PUBLIC_ORDER_COLUMNS =
  "id, order_number, status, payment_status, currency, subtotal_minor, discount_minor, tax_minor, tax_basis_points, shipping_minor, total_minor, amount_paid_minor, notes, due_on, invoice_token_hash, fulfilled_at, cancelled_at, created_at, updated_at, contact_id, workspace_id";

const ORDER_ITEM_COLUMNS =
  "id, description, quantity, unit_price_minor, line_total_minor, product_id, position";

const PAYMENT_COLUMNS = "id, amount_minor, method, reference, paid_at";

function currencyOf(
  value: string,
  fallback: CurrencyCode = "INR",
): CurrencyCode {
  return isCurrencyCode(value) ? value : fallback;
}

/** Strips the characters that would change the meaning of an ILIKE pattern. */
function likePattern(term: string): string {
  return `%${term.replace(/[%_\\,()*]/g, " ").trim()}%`;
}

async function findContactIdsByName(
  workspaceId: string,
  term: string,
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("full_name", likePattern(term))
    .limit(200);

  if (error) {
    logger.error("order_contact_search_failed", { code: error.code });
    return [];
  }
  return (data ?? []).map((row) => row.id);
}

/**
 * The order list, filtered by status, payment status, created-at range and a
 * free-text search over the order number and the customer's name.
 */
export async function listOrders(
  workspaceId: string,
  filters: OrderFilters,
  page = 1,
): Promise<Result<OrderListPage>> {
  const supabase = await createClient();
  const currentPage = Number.isInteger(page) && page > 0 ? page : 1;

  let query = supabase
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .eq("workspace_id", workspaceId);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.payment) query = query.eq("payment_status", filters.payment);
  if (filters.from)
    query = query.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to)
    query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);

  const term = filters.q.trim();
  if (term) {
    const numeric = /^#?\d{1,9}$/.test(term)
      ? Number.parseInt(term.replace("#", ""), 10)
      : null;
    const contactIds = await findContactIdsByName(workspaceId, term);

    if (numeric !== null && contactIds.length > 0) {
      query = query.or(
        `order_number.eq.${numeric},contact_id.in.(${contactIds.join(",")})`,
      );
    } else if (numeric !== null) {
      query = query.eq("order_number", numeric);
    } else if (contactIds.length > 0) {
      query = query.in("contact_id", contactIds);
    } else {
      return ok({ rows: [], totalCount: 0, page: 1, pageCount: 1 });
    }
  }

  const offset = (currentPage - 1) * ORDERS_PAGE_SIZE;

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + ORDERS_PAGE_SIZE - 1);

  if (error) {
    logger.error("orders_list_failed", { code: error.code });
    return err("unknown", "We could not load your orders. Please try again.");
  }

  const orders = data ?? [];
  const contactIds = [
    ...new Set(
      orders.flatMap((order) => (order.contact_id ? [order.contact_id] : [])),
    ),
  ];
  const orderIds = orders.map((order) => order.id);

  // Related rows are fetched separately (embedded selects are not available on
  // the hand-written types) and joined below.
  const contactRows: { id: string; full_name: string }[] = contactIds.length
    ? ((
        await supabase
          .from("contacts")
          .select("id, full_name")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      ).data ?? [])
    : [];

  const itemRows: { order_id: string }[] = orderIds.length
    ? ((
        await supabase
          .from("order_items")
          .select("order_id")
          .eq("workspace_id", workspaceId)
          .in("order_id", orderIds)
      ).data ?? [])
    : [];

  const nameById = new Map(contactRows.map((row) => [row.id, row.full_name]));
  const itemCountByOrder = new Map<string, number>();
  for (const item of itemRows) {
    itemCountByOrder.set(
      item.order_id,
      (itemCountByOrder.get(item.order_id) ?? 0) + 1,
    );
  }

  const rows: OrderListRow[] = orders.map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    status: order.status as OrderStatusValue,
    paymentStatus: order.payment_status as PaymentStatusValue,
    currency: currencyOf(order.currency),
    totalMinor: Number(order.total_minor),
    amountPaidMinor: Number(order.amount_paid_minor),
    outstandingMinor: outstandingMinor(
      Number(order.total_minor),
      Number(order.amount_paid_minor),
    ),
    createdAt: order.created_at,
    dueOn: order.due_on,
    contactName: order.contact_id
      ? (nameById.get(order.contact_id) ?? null)
      : null,
    itemCount: itemCountByOrder.get(order.id) ?? 0,
  }));

  const totalCount = count ?? rows.length;

  return ok({
    rows,
    totalCount,
    page: currentPage,
    pageCount: Math.max(1, Math.ceil(totalCount / ORDERS_PAGE_SIZE)),
  });
}

/** One order with its line items, payments, customer and linked follow-ups. */
export async function getOrderDetail(
  workspaceId: string,
  orderId: string,
): Promise<Result<OrderDetail>> {
  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    logger.error("order_read_failed", { code: error.code });
    return err("unknown", "We could not load this order. Please try again.");
  }
  if (!order) return err("not_found", "That order no longer exists.");

  const [itemsResult, paymentsResult, tasksResult, contactResult] =
    await Promise.all([
      supabase
        .from("order_items")
        .select(ORDER_ITEM_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("order_id", orderId)
        .order("position", { ascending: true }),
      supabase
        .from("payments")
        .select(PAYMENT_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("order_id", orderId)
        .order("paid_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, title, status, due_at, created_at, completed_at")
        .eq("workspace_id", workspaceId)
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      order.contact_id
        ? supabase
            .from("contacts")
            .select("id, full_name, phone_display, email, city")
            .eq("workspace_id", workspaceId)
            .eq("id", order.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (itemsResult.error) {
    logger.error("order_items_read_failed", { code: itemsResult.error.code });
    return err("unknown", "We could not load the items on this order.");
  }

  const contact = contactResult.data;

  return ok({
    id: order.id,
    orderNumber: order.order_number,
    status: order.status as OrderStatusValue,
    paymentStatus: order.payment_status as PaymentStatusValue,
    currency: currencyOf(order.currency),
    subtotalMinor: Number(order.subtotal_minor),
    discountMinor: Number(order.discount_minor),
    taxMinor: Number(order.tax_minor),
    taxBasisPoints: Number(order.tax_basis_points),
    shippingMinor: Number(order.shipping_minor),
    totalMinor: Number(order.total_minor),
    amountPaidMinor: Number(order.amount_paid_minor),
    outstandingMinor: outstandingMinor(
      Number(order.total_minor),
      Number(order.amount_paid_minor),
    ),
    notes: order.notes,
    dueOn: order.due_on,
    hasShareLink: Boolean(order.invoice_token_hash),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    fulfilledAt: order.fulfilled_at,
    cancelledAt: order.cancelled_at,
    contact: contact
      ? {
          id: contact.id,
          fullName: contact.full_name,
          phoneDisplay: contact.phone_display,
          email: contact.email,
          city: contact.city,
        }
      : null,
    items: (itemsResult.data ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: Number(item.unit_price_minor),
      lineTotalMinor: Number(item.line_total_minor),
      productId: item.product_id,
    })),
    payments: (paymentsResult.data ?? []).map((payment) => ({
      id: payment.id,
      amountMinor: Number(payment.amount_minor),
      method: payment.method as PaymentMethodValue,
      reference: payment.reference,
      paidAt: payment.paid_at,
    })),
    tasks: (tasksResult.data ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      createdAt: task.created_at,
      completedAt: task.completed_at,
    })),
  });
}

/** Customers and products offered by the order editor. */
export async function getOrderFormOptions(
  workspaceId: string,
): Promise<OrderFormOptions> {
  const supabase = await createClient();

  const [contacts, products] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name, phone_display, city")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("full_name", { ascending: true })
      .limit(500),
    supabase
      .from("products")
      .select("id, name, price_minor, sale_price_minor, currency, status")
      .eq("workspace_id", workspaceId)
      .neq("status", "archived")
      .order("name", { ascending: true })
      .limit(500),
  ]);

  if (contacts.error) {
    logger.error("order_contacts_options_failed", {
      code: contacts.error.code,
    });
  }
  if (products.error) {
    logger.error("order_product_options_failed", { code: products.error.code });
  }

  return {
    contacts: (contacts.data ?? []).map((row) => ({
      id: row.id,
      label: row.full_name,
      hint: row.phone_display ?? row.city,
    })),
    products: (products.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      // The catalogue's sale price is the price a customer is quoted.
      priceMinor: Number(row.sale_price_minor ?? row.price_minor),
      currency: currencyOf(row.currency),
    })),
  };
}

export type TimelineEvent = {
  key: string;
  at: string;
  title: string;
  detail?: string;
  tone: "default" | "success" | "warning" | "destructive";
};

/**
 * The activity timeline is derived from rows that already exist - order
 * timestamps, payments and linked follow-ups - so it can never drift from what
 * actually happened.
 */
export function buildOrderTimeline(order: OrderDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      key: "created",
      at: order.createdAt,
      title: `Order #${order.orderNumber} created`,
      detail: `${order.items.length} item${order.items.length === 1 ? "" : "s"}`,
      tone: "default",
    },
  ];

  for (const payment of order.payments) {
    events.push({
      key: `payment-${payment.id}`,
      at: payment.paidAt,
      title: "Payment recorded",
      detail: payment.reference ? `Reference ${payment.reference}` : undefined,
      tone: "success",
    });
  }

  for (const task of order.tasks) {
    events.push({
      key: `task-${task.id}`,
      at: task.createdAt,
      title: "Follow-up created",
      detail: task.title,
      tone: "warning",
    });
    if (task.completedAt) {
      events.push({
        key: `task-done-${task.id}`,
        at: task.completedAt,
        title: "Follow-up completed",
        detail: task.title,
        tone: "success",
      });
    }
  }

  if (order.fulfilledAt) {
    events.push({
      key: "fulfilled",
      at: order.fulfilledAt,
      title: "Marked as delivered",
      tone: "success",
    });
  }

  if (order.cancelledAt) {
    events.push({
      key: "cancelled",
      at: order.cancelledAt,
      title: "Order cancelled",
      tone: "destructive",
    });
  }

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// ---------------------------------------------------------------------------
// Public invoice
// ---------------------------------------------------------------------------

export type PublicInvoice = {
  orderNumber: number;
  status: OrderStatusValue;
  paymentStatus: PaymentStatusValue;
  currency: CurrencyCode;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxBasisPoints: number;
  shippingMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  outstandingMinor: number;
  notes: string | null;
  dueOn: string | null;
  issuedOn: string;
  sellerName: string;
  sellerCity: string | null;
  sellerWhatsApp: string | null;
  customerName: string | null;
  items: OrderItemView[];
  payments: PaymentView[];
};

/**
 * Resolves a public invoice from a share token.
 *
 * Anonymous visitors have no RLS grant on `orders`, so this is one of the few
 * places that legitimately uses the service-role client. Everything it returns
 * is scoped to the single order the token resolves to - no other workspace data
 * is read, and the token itself is never stored or logged.
 */
export async function getInvoiceByToken(
  token: string,
): Promise<Result<PublicInvoice>> {
  if (!isShareTokenShape(token)) {
    return err("not_found", "This invoice link is not valid.");
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    logger.error("invoice_share_not_configured");
    return err(
      "not_configured",
      "Shared invoices are not available right now. Please ask the seller to resend it.",
    );
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select(PUBLIC_ORDER_COLUMNS)
    .eq("invoice_token_hash", hashShareToken(token))
    .maybeSingle();

  if (error) {
    logger.error("invoice_token_lookup_failed", { code: error.code });
    return err("unknown", "We could not open this invoice. Please try again.");
  }

  // Re-verify in constant time: the row was matched by the database, but the
  // decision to show it is made here.
  if (
    !order?.invoice_token_hash ||
    !verifyShareToken(token, order.invoice_token_hash)
  ) {
    return err("not_found", "This invoice link is not valid.");
  }

  const [
    itemsResult,
    paymentsResult,
    businessResult,
    workspaceResult,
    contact,
  ] = await Promise.all([
    supabase
      .from("order_items")
      .select(ORDER_ITEM_COLUMNS)
      .eq("order_id", order.id)
      .order("position", { ascending: true }),
    supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("order_id", order.id)
      .order("paid_at", { ascending: false }),
    supabase
      .from("business_profiles")
      .select("business_name, city, whatsapp_number")
      .eq("workspace_id", order.workspace_id)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("name")
      .eq("id", order.workspace_id)
      .maybeSingle(),
    order.contact_id
      ? supabase
          .from("contacts")
          .select("full_name")
          .eq("id", order.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return ok({
    orderNumber: order.order_number,
    status: order.status as OrderStatusValue,
    paymentStatus: order.payment_status as PaymentStatusValue,
    currency: currencyOf(order.currency),
    subtotalMinor: Number(order.subtotal_minor),
    discountMinor: Number(order.discount_minor),
    taxMinor: Number(order.tax_minor),
    taxBasisPoints: Number(order.tax_basis_points),
    shippingMinor: Number(order.shipping_minor),
    totalMinor: Number(order.total_minor),
    amountPaidMinor: Number(order.amount_paid_minor),
    outstandingMinor: outstandingMinor(
      Number(order.total_minor),
      Number(order.amount_paid_minor),
    ),
    notes: order.notes,
    dueOn: order.due_on,
    issuedOn: order.created_at,
    sellerName:
      businessResult.data?.business_name ?? workspaceResult.data?.name ?? "",
    sellerCity: businessResult.data?.city ?? null,
    sellerWhatsApp: businessResult.data?.whatsapp_number ?? null,
    customerName: contact.data?.full_name ?? null,
    items: (itemsResult.data ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: Number(item.unit_price_minor),
      lineTotalMinor: Number(item.line_total_minor),
      productId: item.product_id,
    })),
    payments: (paymentsResult.data ?? []).map((payment) => ({
      id: payment.id,
      amountMinor: Number(payment.amount_minor),
      method: payment.method as PaymentMethodValue,
      reference: payment.reference,
      paidAt: payment.paid_at,
    })),
  });
}
