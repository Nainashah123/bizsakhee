import { z } from "zod";

/**
 * AI input and output contracts.
 *
 * Model output is untrusted input: every response is validated against these
 * schemas before it reaches the database or the screen. A response that does
 * not fit is a failure, never something we render "best effort".
 */

export const AI_TONES = [
  "friendly",
  "professional",
  "warm",
  "brief",
  "apologetic",
  "enthusiastic",
] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_LANGUAGES = [
  "en",
  "hi",
  "hinglish",
  "mr",
  "gu",
  "ta",
  "te",
  "bn",
  "kn",
  "ml",
  "pa",
] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

export const AI_LANGUAGE_LABELS: Record<AiLanguage, string> = {
  en: "English",
  hi: "हिन्दी (Hindi)",
  hinglish: "Hinglish",
  mr: "मराठी (Marathi)",
  gu: "ગુજરાતી (Gujarati)",
  ta: "தமிழ் (Tamil)",
  te: "తెలుగు (Telugu)",
  bn: "বাংলা (Bengali)",
  kn: "ಕನ್ನಡ (Kannada)",
  ml: "മലയാളം (Malayalam)",
  pa: "ਪੰਜਾਬੀ (Punjabi)",
};

export const AI_PLATFORMS = [
  "instagram",
  "whatsapp_status",
  "facebook",
  "generic",
] as const;
export type AiPlatform = (typeof AI_PLATFORMS)[number];

export const AI_OBJECTIVES = [
  "announce_product",
  "run_offer",
  "restock",
  "festive",
  "build_trust",
  "invite_enquiries",
] as const;

// ---------------------------------------------------------------------------
// Smart Reply
// ---------------------------------------------------------------------------

export const smartReplyInputSchema = z.object({
  /** The customer's message. Kept out of logs. */
  customerMessage: z
    .string()
    .trim()
    .min(1, "Paste the customer's message")
    .max(2_000, "That message is too long to draft a reply for"),
  contactName: z.string().trim().max(120).optional(),
  /** Free-text context the seller adds, e.g. "she ordered last Diwali". */
  context: z.string().trim().max(500).optional(),
  tone: z.enum(AI_TONES).default("friendly"),
  language: z.enum(AI_LANGUAGES).default("en"),
});

export type SmartReplyInput = z.infer<typeof smartReplyInputSchema>;

export const smartReplyOutputSchema = z.object({
  /** The suggested reply, ready to send after the seller edits it. */
  reply: z
    .string()
    .trim()
    .min(1)
    .max(1_200)
    .describe("A short, sendable reply in the requested language and tone."),
  /** Optional question that keeps the conversation moving. */
  followUpQuestion: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe("One optional question to keep the conversation going."),
});

export type SmartReplyOutput = z.infer<typeof smartReplyOutputSchema>;

// ---------------------------------------------------------------------------
// Marketing content
// ---------------------------------------------------------------------------

export const contentInputSchema = z.object({
  productName: z.string().trim().min(1, "Which product is this for?").max(160),
  productDescription: z.string().trim().max(600).optional(),
  priceLabel: z.string().trim().max(40).optional(),
  platform: z.enum(AI_PLATFORMS).default("instagram"),
  objective: z.enum(AI_OBJECTIVES).default("announce_product"),
  offer: z.string().trim().max(160).optional(),
  tone: z.enum(AI_TONES).default("friendly"),
  language: z.enum(AI_LANGUAGES).default("en"),
  /** What is visible in the photo, when the seller cares to say. */
  imageContext: z.string().trim().max(300).optional(),
});

export type ContentInput = z.infer<typeof contentInputSchema>;

export const contentOutputSchema = z.object({
  hook: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe("A first line that stops the scroll."),
  caption: z
    .string()
    .trim()
    .min(1)
    .max(1_500)
    .describe("The main caption for the chosen platform."),
  callToAction: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("What the reader should do next."),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .regex(
          /^#[\p{L}\p{N}_]+$/u,
          "Hashtags must start with # and have no spaces",
        ),
    )
    .max(15)
    .describe("Relevant hashtags, each starting with #."),
  whatsappMessage: z
    .string()
    .trim()
    .min(1)
    .max(700)
    .describe("A shorter version to paste into a WhatsApp broadcast."),
});

export type ContentOutput = z.infer<typeof contentOutputSchema>;

export const AI_TOOLS = ["smart_reply", "content_generator"] as const;
export type AiToolName = (typeof AI_TOOLS)[number];

/**
 * Output schema per tool, so a route can validate generically.
 */
export const OUTPUT_SCHEMA_BY_TOOL = {
  smart_reply: smartReplyOutputSchema,
  content_generator: contentOutputSchema,
} as const;
