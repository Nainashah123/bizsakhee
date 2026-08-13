import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "@/lib/money";

export const BUSINESS_CATEGORIES = [
  "boutique",
  "jewellery",
  "home-baking",
  "cloud-kitchen",
  "makeup-artist",
  "mehendi-artist",
  "tutoring",
  "coaching",
  "freelancing",
  "reselling",
  "salon",
  "home-services",
  "other",
] as const;

export const BUSINESS_CATEGORY_LABELS: Record<
  (typeof BUSINESS_CATEGORIES)[number],
  string
> = {
  boutique: "Boutique / clothing",
  jewellery: "Jewellery",
  "home-baking": "Home baking",
  "cloud-kitchen": "Cloud kitchen",
  "makeup-artist": "Makeup artist",
  "mehendi-artist": "Mehendi artist",
  tutoring: "Tutoring",
  coaching: "Coaching",
  freelancing: "Freelancing",
  reselling: "Reselling",
  salon: "Salon",
  "home-services": "Home services",
  other: "Something else",
};

export const SALES_CHANNELS = [
  "whatsapp",
  "instagram",
  "phone",
  "email",
  "other",
] as const;

export const SALES_CHANNEL_LABELS: Record<
  (typeof SALES_CHANNELS)[number],
  string
> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  phone: "Phone calls",
  email: "Email",
  other: "Somewhere else",
};

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "mr", label: "मराठी (Marathi)" },
  { value: "gu", label: "ગુજરાતી (Gujarati)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "te", label: "తెలుగు (Telugu)" },
  { value: "bn", label: "বাংলা (Bengali)" },
  { value: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { value: "ml", label: "മലയാളം (Malayalam)" },
  { value: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
] as const;

const checkbox = z
  .union([
    z.literal("on"),
    z.literal("true"),
    z.literal("false"),
    z.undefined(),
  ])
  .transform((value) => value === "on" || value === "true");

export const onboardingSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Tell us your name")
    .max(80, "Name is too long"),
  businessName: z
    .string()
    .trim()
    .min(2, "Your business needs a name")
    .max(120, "Business name is too long"),
  category: z.enum(BUSINESS_CATEGORIES, {
    message: "Pick the closest category",
  }),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code")
    .transform((value) => value.toUpperCase())
    .default("IN"),
  language: z.string().trim().min(2).max(10).default("en"),
  currency: z.enum(SUPPORTED_CURRENCIES, { message: "Pick a currency" }),
  primaryChannel: z.enum(SALES_CHANNELS, {
    message: "Where do most enquiries come from?",
  }),
  whatsappNumber: z.string().trim().max(20).optional().or(z.literal("")),
  includeDemoData: checkbox,
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
