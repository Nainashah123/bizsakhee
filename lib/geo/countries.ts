/**
 * Countries offered during onboarding and in settings.
 *
 * Deliberately a short list rather than all 249 ISO codes: it covers India and
 * the places the Indian diaspora most commonly sells into, and a short list is
 * far easier to use on a phone than an endless scroll. Adding one is a single
 * line here - the stored value is a plain ISO 3166-1 alpha-2 code either way,
 * so nothing else has to change.
 *
 * `currency` is the sensible default to preselect, not a restriction.
 */

export type Country = {
  code: string;
  name: string;
  currency: string;
  /** Default IANA timezone, used when creating the workspace. */
  timezone: string;
};

export const COUNTRIES: readonly Country[] = [
  { code: "IN", name: "India", currency: "INR", timezone: "Asia/Kolkata" },
  {
    code: "AE",
    name: "United Arab Emirates",
    currency: "AED",
    timezone: "Asia/Dubai",
  },
  {
    code: "SG",
    name: "Singapore",
    currency: "SGD",
    timezone: "Asia/Singapore",
  },
  {
    code: "GB",
    name: "United Kingdom",
    currency: "GBP",
    timezone: "Europe/London",
  },
  {
    code: "US",
    name: "United States",
    currency: "USD",
    timezone: "America/New_York",
  },
  {
    code: "CA",
    name: "Canada",
    currency: "USD",
    timezone: "America/Toronto",
  },
  {
    code: "AU",
    name: "Australia",
    currency: "USD",
    timezone: "Australia/Sydney",
  },
] as const;

export const DEFAULT_COUNTRY = "IN";

export function isSupportedCountry(code: unknown): code is string {
  return (
    typeof code === "string" &&
    COUNTRIES.some((country) => country.code === code.toUpperCase())
  );
}

export function countryByCode(code: string | null | undefined): Country {
  const match = COUNTRIES.find(
    (country) => country.code === (code ?? "").toUpperCase(),
  );
  return match ?? COUNTRIES[0];
}

export function countryName(code: string | null | undefined): string {
  return countryByCode(code).name;
}
