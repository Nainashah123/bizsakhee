/**
 * View contracts for the AI panels.
 *
 * These are deliberately plain types with no imports. `lib/ai/*` reads provider
 * keys and must never be pulled into a Client Component bundle - not even for a
 * constant - so the server page reads the real lists from `lib/ai/schemas` and
 * `lib/ai/prompts` and hands them down as props.
 *
 * The source of truth for every shape below is `lib/ai/schemas.ts`. The routes
 * validate model output against those Zod schemas twice before anything reaches
 * the browser, so these types describe already-validated data.
 */

export type SelectOption = { value: string; label: string };

export type AiOptionSets = {
  tones: SelectOption[];
  languages: SelectOption[];
  platforms: SelectOption[];
  objectives: SelectOption[];
};

/** A product the seller can pull details from instead of retyping them. */
export type ProductOption = {
  id: string;
  name: string;
  /** Formatted for display, e.g. "₹2,400". Sent to the model verbatim. */
  priceLabel: string | null;
};

/** Mirrors `smartReplyOutputSchema`. */
export type SmartReplyDraft = {
  reply: string;
  followUpQuestion?: string;
};

/** Mirrors `contentOutputSchema`. */
export type ContentDraft = {
  hook: string;
  caption: string;
  callToAction: string;
  hashtags: string[];
  whatsappMessage: string;
};

/** This month's allowance, as the API reports it. `null` limit = no cap. */
export type AiQuotaView = {
  used: number;
  limit: number | null;
  remaining: number | null;
};

export function formatQuota(quota: AiQuotaView): string {
  if (quota.limit === null) {
    return `${new Intl.NumberFormat("en-IN").format(quota.used)} used this month · Unlimited`;
  }
  const format = new Intl.NumberFormat("en-IN");
  return `${format.format(quota.used)} of ${format.format(quota.limit)} AI drafts used this month`;
}
