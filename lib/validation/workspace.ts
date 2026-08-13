import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  BUSINESS_CATEGORIES,
  SALES_CHANNELS,
} from "@/lib/validation/onboarding";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

export const workspaceSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give your workspace a name")
    .max(120, "That name is too long"),
  currency: z.enum(SUPPORTED_CURRENCIES, { message: "Pick a currency" }),
  isCataloguePublic: z
    .union([
      z.literal("on"),
      z.literal("true"),
      z.literal("false"),
      z.undefined(),
    ])
    .transform((value) => value === "on" || value === "true"),
  businessName: z
    .string()
    .trim()
    .min(2, "Give your business a name")
    .max(120, "That name is too long"),
  category: z.enum(BUSINESS_CATEGORIES, { message: "Pick a category" }),
  primaryChannel: z.enum(SALES_CHANNELS, { message: "Pick a channel" }),
  city: optionalText(80),
  whatsappNumber: optionalText(20),
  description: optionalText(400),
});

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;

export const profileSettingsSchema = z.object({
  fullName: z.string().trim().min(2, "Tell us your name").max(80),
  preferredLanguage: z.string().trim().min(2).max(10),
});

export type ProfileSettingsInput = z.infer<typeof profileSettingsSchema>;
