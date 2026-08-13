/**
 * Contact normalisation.
 *
 * Phone numbers arrive as "+91 98765 43210", "098765-43210" or
 * "919876543210". Duplicate detection and WhatsApp deep links both need one
 * canonical form: digits only, country code included, no leading plus.
 */

export type NormalizedPhone = {
  /** Digits only, including country code. Stored in `phone_normalized`. */
  normalized: string;
  /** "+91 98765 43210" style value shown in the UI. */
  display: string;
};

const DIGITS = /\d/g;

/** Default dialling codes for the countries BizSakhi ships with. */
const DIALLING_CODES: Record<string, string> = {
  IN: "91",
  US: "1",
  GB: "44",
  AE: "971",
  SG: "65",
  CA: "1",
  AU: "61",
};

/** National significant number lengths, used to spot a missing country code. */
const NATIONAL_LENGTHS: Record<string, number> = {
  IN: 10,
  US: 10,
  CA: 10,
  GB: 10,
  AE: 9,
  SG: 8,
  AU: 9,
};

export function normalizePhone(
  input: string | null | undefined,
  defaultCountry = "IN",
): NormalizedPhone | null {
  if (!input) return null;

  const raw = input.trim();
  if (raw === "") return null;

  const digits = (raw.match(DIGITS) ?? []).join("");
  if (digits.length < 6) return null;

  const country = defaultCountry.toUpperCase();
  const code = DIALLING_CODES[country] ?? "";
  const nationalLength = NATIONAL_LENGTHS[country];

  let normalized = digits;

  if (raw.startsWith("+") || raw.startsWith("00")) {
    // Already international: strip a leading 00 if that is how it was written.
    normalized = raw.startsWith("00") ? digits.slice(2) : digits;
  } else if (nationalLength && code) {
    if (digits.length === nationalLength) {
      normalized = `${code}${digits}`;
    } else if (digits.length === nationalLength + 1 && digits.startsWith("0")) {
      // National trunk prefix, e.g. 098765 43210.
      normalized = `${code}${digits.slice(1)}`;
    }
  }

  if (normalized.length < 6 || normalized.length > 15) return null;

  return { normalized, display: formatPhoneForDisplay(normalized) };
}

function formatPhoneForDisplay(normalized: string): string {
  // Group as +<code> <rest in blocks of five> - readable without pretending to
  // know every national formatting convention.
  for (const code of ["971", "91", "44", "65", "61", "1"]) {
    if (normalized.startsWith(code) && normalized.length > code.length) {
      const rest = normalized.slice(code.length);
      const grouped = rest.replace(/(\d{5})(?=\d)/g, "$1 ");
      return `+${code} ${grouped}`.trim();
    }
  }
  return `+${normalized}`;
}

/** Deep link that opens a WhatsApp chat with an optional prefilled message. */
export function whatsappLink(normalized: string, message?: string): string {
  const base = `https://wa.me/${normalized}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function normalizeEmail(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  return value === "" ? null : value;
}

/** Comparison key for duplicate detection on names. */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
