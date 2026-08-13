import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { err, ok, type Result } from "@/lib/result";
import {
  can,
  isRole,
  type Capability,
  type WorkspaceRole,
} from "@/lib/permissions";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  country: string;
  timezone: string;
  isCataloguePublic: boolean;
  role: WorkspaceRole;
};

export type SessionContext = {
  user: User;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary | null;
  onboarded: boolean;
};

/**
 * The authenticated user, validated against Supabase rather than read from the
 * cookie payload. `cache` dedupes the call across a single render pass.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) return null;
  return user;
});

/**
 * Every workspace the user actually belongs to, with their role. This is the
 * only place a workspace id becomes trusted - it is never taken from a form
 * field or query string without passing through here.
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const supabase = await createClient();

    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (!memberships?.length) {
      return { user, workspaces: [], workspace: null, onboarded: false };
    }

    const roleByWorkspace = new Map(
      memberships
        .filter((membership) => isRole(membership.role))
        .map((membership) => [membership.workspace_id, membership.role]),
    );

    const { data: rows } = await supabase
      .from("workspaces")
      .select(
        "id, name, slug, currency, country, timezone, is_catalogue_public",
      )
      .in("id", [...roleByWorkspace.keys()]);

    // Preserve join order so the first workspace a user joined stays default.
    const byId = new Map((rows ?? []).map((row) => [row.id, row]));

    const workspaces: WorkspaceSummary[] = memberships.flatMap((membership) => {
      const workspace = byId.get(membership.workspace_id);
      const role = roleByWorkspace.get(membership.workspace_id);
      if (!workspace || !role) return [];
      return [
        {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          currency: workspace.currency,
          country: workspace.country,
          timezone: workspace.timezone,
          isCataloguePublic: workspace.is_catalogue_public,
          role,
        },
      ];
    });

    return {
      user,
      workspaces,
      workspace: workspaces[0] ?? null,
      onboarded: workspaces.length > 0,
    };
  },
);

/** Redirects to sign-in when there is no verified user. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Redirects to sign-in, or to onboarding when the user has no workspace yet.
 * Use this at the top of every authenticated page and Server Action.
 */
export async function requireWorkspace(): Promise<{
  user: User;
  workspace: WorkspaceSummary;
}> {
  const context = await getSessionContext();
  if (!context) redirect("/login");
  if (!context.workspace) redirect("/onboarding");
  return { user: context.user, workspace: context.workspace };
}

/**
 * Non-redirecting variant for Server Actions and Route Handlers, which should
 * return a typed error instead of throwing a navigation.
 */
export async function resolveWorkspace(
  workspaceId?: string,
): Promise<Result<{ user: User; workspace: WorkspaceSummary }>> {
  const context = await getSessionContext();
  if (!context) return err("unauthenticated", "Please sign in to continue.");

  const workspace = workspaceId
    ? (context.workspaces.find((item) => item.id === workspaceId) ?? null)
    : context.workspace;

  if (!workspace) {
    // Either the workspace does not exist or the user is not a member; the
    // message is identical so membership cannot be probed.
    return err("forbidden", "You do not have access to this workspace.");
  }

  return ok({ user: context.user, workspace });
}

/** Resolves the workspace and asserts a capability in one step. */
export async function requireCapability(
  capability: Capability,
  workspaceId?: string,
): Promise<Result<{ user: User; workspace: WorkspaceSummary }>> {
  const resolved = await resolveWorkspace(workspaceId);
  if (!resolved.ok) return resolved;

  if (!can(resolved.data.workspace.role, capability)) {
    return err(
      "forbidden",
      "Your role does not allow this action. Ask a workspace owner or admin.",
    );
  }

  return resolved;
}
