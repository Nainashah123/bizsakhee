/**
 * Order arithmetic.
 *
 * Pure and dependency-free on purpose: the server recomputes every order total
 * with this function before writing, so a browser can never dictate what an
 * order is worth. Nothing here reads a request, a database or the clock.
 *
 * Every amount is an integer in the currency's minor unit (paise for INR).
 *
 * Order of operations:
 *   line_total = unit_price_minor x quantity
 *   subtotal   = sum(line_total)
 *   discount   = clamp(requested discount, 0, subtotal)
 *   taxable    = subtotal - discount
 *   tax        = applyBasisPoints(taxable, tax_basis_points)
 *   total      = max(0, taxable + tax + shipping)
 */

import { applyBasisPoints, roundMinor, sumMinor } from "@/lib/money";

/** Guard rails that keep a hostile payload from producing absurd arithmetic. */
export const MAX_LINE_QUANTITY = 100_000;
export const MAX_ORDER_LINES = 200;

export type OrderLineInput = {
  /** Snapshot of the product name, or free text for a custom line. */
  description: string;
  quantity: number;
  unitPriceMinor: number;
  productId?: string | null;
  variantId?: string | null;
};

export type OrderLineTotals = {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  productId: string | null;
  variantId: string | null;
};

export type OrderTotalsInput = {
  lines: readonly OrderLineInput[];
  /**
   * Fixed discount in minor units. When this is greater than zero it **wins**
   * over `discountBasisPoints`, which is then ignored entirely. Only one
   * discount is ever applied - they are never stacked.
   */
  discountMinor?: number;
  /** Percentage discount in basis points (1% = 100 bps). Used only when no
   * fixed `discountMinor` was supplied. */
  discountBasisPoints?: number;
  /** Tax rate in basis points, applied to (subtotal - discount). */
  taxBasisPoints?: number;
  shippingMinor?: number;
};

export type OrderTotals = {
  lines: OrderLineTotals[];
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxBasisPoints: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
};

/** A non-negative whole amount in minor units, or a RangeError. */
function requireMinorAmount(value: number | undefined, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be a whole number of minor units`);
  }
  if (value < 0) throw new RangeError(`${label} cannot be negative`);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is too large`);
  }
  return value;
}

function requireBasisPoints(value: number | undefined, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError(`${label} must be an integer between 0 and 10000`);
  }
  return value;
}

/**
 * Quantities are stored as a whole number of units, so a fractional quantity is
 * rounded half away from zero (1.5 -> 2, 2.4 -> 2) rather than silently
 * truncating a customer's order. A quantity that rounds to zero is rejected.
 */
function requireQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("Quantity must be a finite number");
  }
  const quantity = roundMinor(value);
  if (quantity < 1) throw new RangeError("Quantity must be at least 1");
  if (quantity > MAX_LINE_QUANTITY) {
    throw new RangeError(`Quantity cannot exceed ${MAX_LINE_QUANTITY}`);
  }
  return quantity;
}

/**
 * Recomputes every derived amount on an order.
 *
 * Note the input type has no `total` field: there is deliberately no way to
 * pass a precomputed total in, so a client-supplied one cannot survive.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  if (input.lines.length > MAX_ORDER_LINES) {
    throw new RangeError(
      `An order cannot have more than ${MAX_ORDER_LINES} lines`,
    );
  }

  const lines: OrderLineTotals[] = input.lines.map((line) => {
    const quantity = requireQuantity(line.quantity);
    const unitPriceMinor = requireMinorAmount(
      line.unitPriceMinor,
      "Unit price",
    );
    return {
      description: line.description,
      quantity,
      unitPriceMinor,
      lineTotalMinor: roundMinor(unitPriceMinor * quantity),
      productId: line.productId ?? null,
      variantId: line.variantId ?? null,
    };
  });

  const subtotalMinor = sumMinor(lines.map((line) => line.lineTotalMinor));

  const fixedDiscount = requireMinorAmount(input.discountMinor, "Discount");
  const discountBasisPoints = requireBasisPoints(
    input.discountBasisPoints,
    "Discount rate",
  );

  // Fixed amount wins; the percentage is only consulted when no amount is set.
  const requestedDiscount =
    fixedDiscount > 0
      ? fixedDiscount
      : applyBasisPoints(subtotalMinor, discountBasisPoints);

  // A discount can never turn an order into a refund.
  const discountMinor = Math.min(subtotalMinor, requestedDiscount);
  const taxableMinor = subtotalMinor - discountMinor;

  const taxBasisPoints = requireBasisPoints(input.taxBasisPoints, "Tax rate");
  const taxMinor = applyBasisPoints(taxableMinor, taxBasisPoints);
  const shippingMinor = requireMinorAmount(input.shippingMinor, "Shipping");

  const totalMinor = Math.max(0, taxableMinor + taxMinor + shippingMinor);

  return {
    lines,
    subtotalMinor,
    discountMinor,
    taxableMinor,
    taxBasisPoints,
    taxMinor,
    shippingMinor,
    totalMinor,
  };
}

/** What is still owed on an order. Never negative, even after an overpayment. */
export function outstandingMinor(
  totalMinor: number,
  amountPaidMinor: number,
): number {
  return Math.max(0, roundMinor(totalMinor) - roundMinor(amountPaidMinor));
}
