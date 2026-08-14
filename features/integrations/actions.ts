"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { CHANNEL_PROVIDERS } from "@/features/integrations/queries";
import { CHANNEL_LABELS } from "@/features/integrations/status";

/**
 * Channel mutations.
 *
 * Only disconnect lives here. Connecting is an OAuth round trip owned by
 * `/api/meta/oauth/start`, because a Server Action cannot carry the browser to
 * Meta and back.
 *
 * The capability is checked here, server-side, on every call. The page also
 * hides the button for members, but hiding is decoration - this check is the
 * control.
 */

export type ChannelActionState = {
  status?: "done" | "error";
  message?: string;
};

const disconnectSchema = z.object({
  provider: z.enum(CHANNEL_PROVIDERS),
});

const FAILED =
  "We could not disconnect that channel. Nothing has changed - please try again.";

export async function disconnectChannelAction(
  _previous: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  const parsed = disconnectSchema.safeParse({
    provider: formData.get("provider"),
  });

  if (!parsed.success) {
    return { status: "error", message: "That is not a channel we support." };
  }

  const { provider } = parsed.data;

  // Resolves the workspace from the session and asserts the role in one step.
  // The workspace id is never taken from the form.
  const authorized = await requireCapability("integrations.manage");
  if (!authorized.ok) {
    return { status: "error", message: authorized.error.message };
  }

  const { workspace } = authorized.data;

  // `integrations` has no write policy for the browser role by design, so the
  // write goes through the service-role client - after the check above, never
  // before it.
  if (!serverEnv().SUPABASE_SECRET_KEY) {
    return {
      status: "error",
      message:
        "This deployment is missing SUPABASE_SECRET_KEY, so channel settings cannot be written.",
    };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("integrations")
    .update({
      status: "disconnected",
      // The provider identifiers go, so nothing downstream can keep addressing
      // an account we are no longer authorised for.
      external_account_id: null,
      phone_number_id: null,
      waba_id: null,
      instagram_user_id: null,
      connected_at: null,
      last_error: null,
      scopes: [],
      // Token columns are deliberately untouched: revoking and clearing
      // credentials is the integration layer's job, not this screen's.
    })
    .eq("workspace_id", workspace.id)
    .eq("provider", provider);

  if (error) {
    logger.error("integrations.disconnect_failed", {
      workspaceId: workspace.id,
      provider,
    });
    return { status: "error", message: FAILED };
  }

  revalidatePath("/dashboard/integrations");

  return {
    status: "done",
    message: `${CHANNEL_LABELS[provider]} is disconnected. Meta will stop delivering its messages here.`,
  };
}
