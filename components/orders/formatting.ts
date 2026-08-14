/**
 * Presentation helpers shared by the order and invoice views.
 *
 * Dates are rendered with a fixed locale and UTC so a server-rendered string
 * and a client-rendered one can never disagree during hydration.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** "2026-08-13" or an ISO timestamp -> "13 Aug 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "-";
  return DATE_FORMAT.format(new Date(parsed));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "-";
  return `${DATE_TIME_FORMAT.format(new Date(parsed))} UTC`;
}

/** True when an unpaid order's due date has already passed. */
export function isOverdue(
  dueOn: string | null,
  outstandingMinor: number,
  now: Date = new Date(),
): boolean {
  if (!dueOn || outstandingMinor <= 0) return false;
  const due = Date.parse(`${dueOn}T23:59:59Z`);
  return !Number.isNaN(due) && due < now.getTime();
}

/** A percentage for display, from basis points: 1800 -> "18%". */
export function formatBasisPoints(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
