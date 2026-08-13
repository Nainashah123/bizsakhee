"use server";

import { revalidatePath } from "next/cache";

import { requireCapability, getCurrentUser } from "@/lib/auth/session";
import { normalizePhone } from "@/lib/contacts/normalize";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import {
  profileSettingsSchema,
  workspaceSettingsSchema,
} from "@/lib/validation/workspace";

export type SettingsState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
};

/**
 * Workspace and business details.
 *
 * The workspace id is never taken from the form: `requireCapability` resolves
 * it from the session and confirms the role in one step. Slug and owner are not
 * editable here, so a crafted form cannot reassign ownership.
 */
export async function updateWorkspaceSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const authorized = await requireCapability("workspace.settings");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(workspaceSettingsSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace } = authorized.data;
  const input = parsed.data;
  const supabase = await createClient();

  const { error: workspaceError } = await supabase
    .from("workspaces")
    .update({
      name: input.name,
      currency: input.currency,
      is_catalogue_public: input.isCataloguePublic,
    })
    .eq("id", workspace.id);

  if (workspaceError) {
    logger.error("workspace_update_failed", { code: workspaceError.code });
    return { error: "We could not save those changes. Please try again." };
  }

  const whatsapp = normalizePhone(input.whatsappNumber, workspace.country);

  const { error: businessError } = await supabase
    .from("business_profiles")
    .update({
      business_name: input.businessName,
      category: input.category,
      primary_channel: input.primaryChannel,
      city: input.city ?? null,
      description: input.description ?? null,
      whatsapp_number: whatsapp?.normalized ?? null,
    })
    .eq("workspace_id", workspace.id);

  if (businessError) {
    logger.error("business_profile_update_failed", {
      code: businessError.code,
    });
    return { error: "We saved the workspace, but not the business details." };
  }

  await supabase.from("audit_logs").insert({
    workspace_id: workspace.id,
    actor_id: authorized.data.user.id,
    action: "workspace.settings.updated",
    entity_type: "workspace",
    entity_id: workspace.id,
    metadata: { catalogue_public: input.isCataloguePublic },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard", "layout");
  return { message: "Saved." };
}

export async function updateProfileAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in to continue." };

  const parsed = parseFormData(profileSettingsSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      preferred_language: parsed.data.preferredLanguage,
    })
    .eq("id", user.id);

  if (error) {
    logger.error("profile_update_failed", { code: error.code });
    return { error: "We could not save your profile. Please try again." };
  }

  // Keeps the greeting and avatar initials in sync with the profile row.
  await supabase.auth.updateUser({ data: { full_name: parsed.data.fullName } });

  revalidatePath("/dashboard", "layout");
  return { message: "Saved." };
}
