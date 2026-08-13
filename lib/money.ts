/**
 * Money handling.
 *
 * All amounts are integers in the currency's minor unit (paise for INR).
 * Floating point never touches a stored or transmitted amount.
 */

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP" | "AED" | "SGD";

export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SGD",
] as const;

const MINOR_UNITS: Record<CurrencyCode, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
};

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function minorUnitFactor(currency: CurrencyCode): number {
  return 10 ** MINOR_UNITS[currency];
}

/** Half-up rounding, symmetric around zero, on a value already in minor units. */
export function roundMinor(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("Amount must be a finite number");
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Shifts a decimal string by `decimals` places and rounds half-up on the
 * remaining digits. Working on the digit string rather than multiplying a
 * double keeps `"1.005"` at 101 paise instead of 100 - binary doubles cannot
 * represent 1.005 exactly, so `1.005 * 100` is 100.4999...
 */
function decimalStringToMinor(raw: string, decimals: number): number {
  const cleaned = raw.trim().replace(/[\s,_]/g, "");
  const match = DECIMAL_PATTERN.exec(cleaned);
  if (!match) throw new RangeError(`Cannot parse amount: ${raw}`);

  const [, signPart, intPart = "", fracPart = "", expPart] = match;
  if (intPart === "" && fracPart === "") {
    throw new RangeError(`Cannot parse amount: ${raw}`);
  }

  const sign = signPart === "-" ? -1 : 1;
  let digits = `${intPart}${fracPart}`;
  // Position of the decimal point within `digits`, after exponent and scaling.
  let point = intPart.length + (expPart ? Number(expPart) : 0) + decimals;

  if (point <= 0) {
    digits = "0".repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) {
    digits += "0".repeat(point - digits.length);
  }

  const whole = digits.slice(0, point);
  const remainder = digits.slice(point);
  const magnitude = Number(whole);
  if (!Number.isSafeInteger(magnitude)) {
    throw new RangeError(`Amount is too large to represent exactly: ${raw}`);
  }

  const roundsUp = remainder.length > 0 && remainder.charCodeAt(0) >= 53; // '5'
  return sign * (magnitude + (roundsUp ? 1 : 0));
}

/** "1,249.50" | 1249.5 -> 124950 minor units. Throws on unparseable input. */
export function toMinorUnits(
  amount: string | number,
  currency: CurrencyCode = "INR",
): number {
  if (typeof amount === "number" && !Number.isFinite(amount)) {
    throw new RangeError(`Cannot parse amount: ${String(amount)}`);
  }
  const raw = typeof amount === "number" ? String(amount) : amount;
  return decimalStringToMinor(raw, MINOR_UNITS[currency]);
}

/** 124950 minor units -> 1249.5 major units. For display only. */
export function toMajorUnits(
  minor: number,
  currency: CurrencyCode = "INR",
): number {
  return minor / minorUnitFactor(currency);
}

export function formatMoney(
  minor: number,
  currency: CurrencyCode = "INR",
  locale = "en-IN",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: MINOR_UNITS[currency],
    maximumFractionDigits: MINOR_UNITS[currency],
  }).format(toMajorUnits(minor, currency));
}

/**
 * Applies a percentage expressed in basis points (1% = 100 bps) to a minor
 * amount. Basis points keep tax and discount rates integral in the database.
 */
export function applyBasisPoints(minor: number, basisPoints: number): number {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError("Basis points must be a non-negative integer");
  }
  return roundMinor((minor * basisPoints) / 10_000);
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, value) => total + roundMinor(value), 0);
}
