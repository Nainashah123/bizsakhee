"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AI_LANGUAGES,
  AI_OBJECTIVES,
  AI_PLATFORMS,
  AI_TONES,
  contentOutputSchema,
} from "@/lib/ai/schemas";
import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";

/**
 * Saving an approved marketing draft.
 *
 * Nothing an AI produces is stored until the seller presses "Save as draft" -
 * generating is a private act, keeping it is a deliberate one. The row records
 * both facts: `is_ai_generated` says a model wrote it, `approved_by` says which
 * human decided to keep it.
 *
 * The workspace comes from the session, never from the form. The optional
 * product and generation references are re-checked against that workspace, so a
 * crafted form cannot attach a draft to another tenant's product.
 */

export type ContentDraftFormState = {
  status?: "saved" | "error";
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  draftId?: string;
};

const SAVE_FAILED = "We could not save that draft. Please try again.";

/** Reuse the model-output rules so a saved draft cannot be looser than a generated one. */
const hashtagListSchema = contentOutputSchema.shape.hashtags;

const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((value) => (value ? value : null));

const draftSchema = z.object({
  generationId: optionalId,
  productId: optionalId,
  platform: z.enum(AI_PLATFORMS),
  objective: z.enum(AI_OBJECTIVES),
  language: z.enum(AI_LANGUAGES),
  tone: z.enum(AI_TONES),
  hook: contentOutputSchema.shape.hook,
  caption: contentOutputSchema.shape.caption,
  callToAction: contentOutputSchema.shape.callToAction,
  whatsappMessage: contentOutputSchema.shape.whatsappMessage,
  /**
   * Hashtags arrive as one whitespace-separated field, because a repeated form
   * key collapses to a scalar when only one value is present. The split list is
   * then held to the same regex the model output must satisfy.
   */
  hashtags: z
    .string()
    .max(600)
    .optional()
    .transform((value) => (value ? value.trim().split(/\s+/) : []))
    .pipe(hashtagListSchema),
});

function invalid(
  message: string,
  fieldErrors?: Record<string, string[]>,
): ContentDraftFormState {
  return { status: "error", error: message, fieldErrors };
}

/** Confirms a row belongs to this workspace before it is referenced. */
async function belongsToWorkspace(
  table: "products" | "ai_generations",
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const supabase = await createClient();

  // Written as a switch rather than a dynamic table name so each query keeps
  // its generated row type.
  if (table === "products") {
    const { data } = await supabase
      .from("products")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    return Boolean(data);
  }

  const { data } = await supabase
    .from("ai_generations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return Boolean(data);
}

export async function saveContentDraftAction(
  _prev: ContentDraftFormState,
  formData: FormData,
): Promise<ContentDraftFormState> {
  const authorized = await requireCapability("ai.use");
  if (!authorized.ok) return invalid(authorized.error.message);

  const parsed = parseFormData(draftSchema, formData);
  if (!parsed.ok) {
    return invalid(parsed.error.message, parsed.error.fieldErrors);
  }

  const { workspace, user } = authorized.data;
  const input = parsed.data;

  if (
    input.productId &&
    !(await belongsToWorkspace("products", workspace.id, input.productId))
  ) {
    return invalid("Please check the highlighted fields.", {
      productId: ["We could not find that product"],
    });
  }

  // A stale or foreign generation id is dropped rather than refused: the draft
  // itself is still the seller's work and losing the audit link is not fatal.
  const generationId =
    input.generationId &&
    (await belongsToWorkspace(
      "ai_generations",
      workspace.id,
      input.generationId,
    ))
      ? input.generationId
      : null;

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("content_drafts")
    .insert({
      workspace_id: workspace.id,
      product_id: input.productId,
      ai_generation_id: generationId,
      platform: input.platform,
      objective: input.objective,
      language: input.language,
      tone: input.tone,
      hook: input.hook,
      caption: input.caption,
      call_to_action: input.callToAction,
      hashtags: input.hashtags,
      whatsapp_message: input.whatsappMessage,
      status: "draft",
      is_ai_generated: true,
      approved_by: user.id,
      approved_at: now,
      created_by: user.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // The caption is never logged - only that the write failed and why.
    logger.error("content_draft_insert_failed", { code: error.code });
    return invalid(SAVE_FAILED);
  }

  revalidatePath("/dashboard/ai");

  return {
    status: "saved",
    message: "Saved to your drafts.",
    draftId: data?.id,
  };
}
