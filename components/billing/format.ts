import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/money";

/**
 * Display helpers shared by the billing screen and the public pricing page, so
 * a price can never be written one way in one place and another way elsewhere.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Plan prices are whole rupees, so "₹299.00" reads as noise. The amount still
 * comes from the same integer minor units as every other amount in the app.
 */
export function formatPlanPrice(
  minor: number,
  currency: CurrencyCode = "INR",
): string {
  return formatMoney(minor, currency).replace(/\.00$/, "");
}

export function formatBillingDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FORMAT.format(date);
}

/** The calendar month a metered counter belongs to, e.g. "August 2026". */
export function formatUsagePeriod(period: string): string {
  const date = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return period;
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
