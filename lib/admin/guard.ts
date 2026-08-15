import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Access control for the platform admin area.
 *
 * Two deliberate choices:
 *
 * 1. Membership is read with the service role. `platform_admins` has no policy
 *    for authenticated users at all, so a session client sees an empty table -
 *    which would otherwise make every operator look like an impostor.
 *
 * 2. A non-admin gets notFound(), not a 403. A "forbidden" page confirms the
 *    admin area exists and is worth attacking; a 404 tells a curious seller
 *    nothing. Operators know the URL already.
 */

export type PlatformAdmin = {
  user: User;
  email: string;
};

export const getPlatformAdmin = cache(
  async (): Promise<PlatformAdmin | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    let admin;
    try {
      admin = createAdminClient();
    } catch {
      // No service key configured: nobody is an operator on this deployment.
      // Failing closed is the only safe answer.
      logger.warn("admin_guard_no_service_key");
      return null;
    }

    const { data, error } = await admin
      .from("platform_admins")
      .select("email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      logger.error("admin_guard_lookup_failed", { code: error.code });
      return null;
    }

    if (!data) return null;

    return { user, email: data.email };
  },
);

/** Use at the top of every admin page. Renders 404 for everyone else. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  return admin;
}

export async function isPlatformAdmin(): Promise<boolean> {
  return (await getPlatformAdmin()) !== null;
}

/**
 * Records that an operator looked at a specific business.
 *
 * Crossing the tenancy boundary is a privilege, not a right, and it leaves a
 * trail. Failure to log is never allowed to break the page - but it is logged
 * loudly, because a silent gap in an audit trail is worse than a noisy one.
 */
export async function recordAdminAccess(
  actor: PlatformAdmin,
  action: string,
  workspaceId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      actor_id: actor.user.id,
      action: `platform.${action}`,
      entity_type: "workspace",
      entity_id: workspaceId,
      metadata: { ...metadata, operator: actor.email },
    });
  } catch (error) {
    logger.error("admin_audit_write_failed", { action, error });
  }
}
