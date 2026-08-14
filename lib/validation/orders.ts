import { z } from "zod";

import { toMinorUnits } from "@/lib/money";
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "@/lib/orders/totals";

/**
 * Order, payment and invoice input schemas.
 *
 * Everything the browser sends passes through here before it reaches a query.
 * Money arrives as a human-typed decimal string and leaves as integer minor
 * units; totals are never accepted from the client at all, so no schema in this
 * file has a `total` field.
 */

export const ORDER_STATUSES = [
  "draft",
  "confirmed",
  "in_progress",
  "ready",
  "fulfilled",
  "cancelled",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  in_progress: "In progress",
  ready: "Ready",
  fulfilled: "Delivered",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUSES = [
  "unpaid",
  "partially_paid",
  "paid",
  "refunded",
] as const;

export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatusValue, string> = {
  unpaid: "Unpaid",
  partially_paid: "Part paid",
  paid: "Paid",
  refunded: "Refunded",
};

export const PAYMENT_METHODS = [
  "upi",
  "cash",
  "bank_transfer",
  "card",
  "cod",
  "other",
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  upi: "UPI",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  cod: "Cash on delivery",
  other: "Other",
};

/** Common Indian GST rates, expressed in basis points. */
export const TAX_RATE_OPTIONS = [
  { value: 0, label: "No tax" },
  { value: 500, label: "GST 5%" },
  { value: 1200, label: "GST 12%" },
  { value: 1800, label: "GST 18%" },
  { value: 2800, label: "GST 28%" },
] as const;

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** Parses a human decimal into minor units, or null when it is unusable. */
function parseDecimalToMinor(raw: string | number): number | null {
  try {
    const minor = toMinorUnits(raw);
    return Number.isSafeInteger(minor) ? minor : null;
  } catch {
    return null;
  }
}

/** Normalises a possibly missing FormData entry into a trimmed string. */
const textField = z
  .union([z.string(), z.number(), z.undefined()])
  .transform((value) => (value === undefined ? "" : String(value).trim()));

/**
 * A non-negative decimal typed by the user, shifted two places.
 *
 * Two decimal places is exactly what money needs (rupees -> paise) and also
 * exactly what a percentage needs (18% -> 1800 basis points), so one helper
 * serves both and the caller decides how to read the result.
 */
function scaledDecimal(label: string, { required = false } = {}) {
  return textField
    .refine((value) => !required || value !== "", `Enter ${label}`)
    .refine(
      (value) => value === "" || parseDecimalToMinor(value) !== null,
      `${label} must be a number, for example 1499.00`,
    )
    .refine(
      (value) => value === "" || (parseDecimalToMinor(value) ?? -1) >= 0,
      `${label} cannot be negative`,
    )
    .transform((value) =>
      value === "" ? 0 : (parseDecimalToMinor(value) ?? 0),
    );
}

const optionalText = (max: number, label = "This") =>
  textField
    .refine((value) => value.length <= max, `${label} is too long`)
    .transform((value) => (value === "" ? null : value));

/** `<input type="date">` produces YYYY-MM-DD, or "" when left blank. */
const optionalDate = textField
  .refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Use a valid date",
  )
  .refine(
    (value) => value === "" || !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "Use a valid date",
  )
  .transform((value) => (value === "" ? null : value));

/** `<input type="datetime-local">` produces YYYY-MM-DDTHH:mm in local time. */
const paidAtField = textField
  .refine((value) => value === "" || !Number.isNaN(Date.parse(value)), {
    message: "Use a valid date and time",
  })
  .transform((value) =>
    value === "" ? new Date().toISOString() : new Date(value).toISOString(),
  )
  .refine(
    (iso) => Date.parse(iso) <= Date.now() + 24 * 60 * 60 * 1000,
    "A payment cannot be dated in the future",
  );

const uuidField = (message: string) => z.uuid(message);

// ---------------------------------------------------------------------------
// Order line items
// ---------------------------------------------------------------------------

/**
 * One line of an order, as sent by the line-item editor.
 *
 * `unitPrice` is only authoritative for custom lines. When `productId` is set
 * the server overwrites both description and price from the product row, so a
 * tampered price cannot lower an invoice.
 */
export const orderItemSchema = z.object({
  productId: z
    .union([z.uuid(), z.literal(""), z.null(), z.undefined()])
    .transform((value) => (value ? value : null)),
  description: z
    .string()
    .trim()
    .min(1, "Describe this line")
    .max(200, "That description is too long"),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(MAX_LINE_QUANTITY, "That quantity is too large"),
  unitPrice: scaledDecimal("the price"),
});

export type OrderItemInput = z.output<typeof orderItemSchema>;

/** The editor posts its rows as one JSON field so nothing is lost or reordered. */
const orderItemsField = z
  .string()
  .refine((value) => {
    try {
      return Array.isArray(JSON.parse(value));
    } catch {
      return false;
    }
  }, "Add at least one item to this order")
  .transform((value) => JSON.parse(value) as unknown[])
  .pipe(
    z
      .array(orderItemSchema)
      .min(1, "Add at least one item to this order")
      .max(MAX_ORDER_LINES, "That is too many lines for one order"),
  );

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const orderBaseShape = {
  contactId: uuidField("Pick the customer this order is for"),
  items: orderItemsField,
  discountType: z.enum(["amount", "percent"]).default("amount"),
  discountValue: scaledDecimal("the discount"),
  taxBasisPoints: z.coerce
    .number()
    .int("Pick a tax rate")
    .min(0, "Pick a tax rate")
    .max(10_000, "Pick a tax rate")
    .default(0),
  shipping: scaledDecimal("delivery charges"),
  notes: optionalText(2000, "The note"),
  dueOn: optionalDate,
  status: z.enum(ORDER_STATUSES).default("draft"),
};

/**
 * Splits the single discount input into the two shapes `computeOrderTotals`
 * understands. Only one of them is ever non-zero.
 */
function withDiscount<
  T extends {
    discountType: "amount" | "percent";
    discountValue: number;
  },
>(data: T) {
  return {
    ...data,
    discountMinor: data.discountType === "amount" ? data.discountValue : 0,
    discountBasisPoints:
      data.discountType === "percent" ? data.discountValue : 0,
  };
}

const percentCeiling = (data: {
  discountType: "amount" | "percent";
  discountValue: number;
}) => data.discountType !== "percent" || data.discountValue <= 10_000;

export const createOrderSchema = z
  .object(orderBaseShape)
  .refine(percentCeiling, {
    message: "A discount cannot be more than 100%",
    path: ["discountValue"],
  })
  .transform(withDiscount);

export const updateOrderSchema = z
  .object({ ...orderBaseShape, orderId: uuidField("Unknown order") })
  .refine(percentCeiling, {
    message: "A discount cannot be more than 100%",
    path: ["discountValue"],
  })
  .transform(withDiscount);

export type CreateOrderInput = z.output<typeof createOrderSchema>;
export type UpdateOrderInput = z.output<typeof updateOrderSchema>;

export const orderIdSchema = z.object({
  orderId: uuidField("Unknown order"),
});

export const updateOrderStatusSchema = z.object({
  orderId: uuidField("Unknown order"),
  status: z.enum(ORDER_STATUSES, { message: "Pick a status" }),
});

export const recordPaymentSchema = z.object({
  orderId: uuidField("Unknown order"),
  amount: scaledDecimal("the amount received", { required: true }).refine(
    (minor) => minor > 0,
    "Enter an amount greater than zero",
  ),
  method: z.enum(PAYMENT_METHODS, { message: "Pick how it was paid" }),
  reference: optionalText(120, "The reference"),
  paidAt: paidAtField,
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;

export const paymentReminderSchema = z.object({
  orderId: uuidField("Unknown order"),
  dueOn: optionalDate,
});

// ---------------------------------------------------------------------------
// List filters (read from the URL, never from a form body)
// ---------------------------------------------------------------------------

export type OrderFilters = {
  status: OrderStatusValue | null;
  payment: PaymentStatusValue | null;
  from: string | null;
  to: string | null;
  q: string;
};

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  status: null,
  payment: null,
  from: null,
  to: null,
  q: "",
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return (value ?? "").trim();
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Filters are best-effort: an unrecognised value is dropped rather than shown
 * as an error, because a URL is not a form the user is filling in.
 */
export function parseOrderFilters(
  params: Record<string, string | string[] | undefined>,
): OrderFilters {
  const status = firstValue(params.status);
  const payment = firstValue(params.payment);
  const from = firstValue(params.from);
  const to = firstValue(params.to);

  return {
    status: (ORDER_STATUSES as readonly string[]).includes(status)
      ? (status as OrderStatusValue)
      : null,
    payment: (PAYMENT_STATUSES as readonly string[]).includes(payment)
      ? (payment as PaymentStatusValue)
      : null,
    from: isDate(from) ? from : null,
    to: isDate(to) ? to : null,
    q: firstValue(params.q).slice(0, 80),
  };
}

export function hasActiveOrderFilters(filters: OrderFilters): boolean {
  return Boolean(
    filters.status ||
    filters.payment ||
    filters.from ||
    filters.to ||
    filters.q,
  );
}
