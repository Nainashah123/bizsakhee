import type { Metadata } from "next";

import {
  ProfileSettingsForm,
  WorkspaceSettingsForm,
} from "@/components/settings/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/auth/session";
import { can, ROLE_LABELS, type WorkspaceRole } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [{ data: business }, { data: profile }, { data: members }] =
    await Promise.all([
      supabase
        .from("business_profiles")
        .select(
          "business_name, category, primary_channel, city, whatsapp_number, description",
        )
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name, preferred_language")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("workspace_members")
        .select("id, role, user_id, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: true }),
    ]);

  const canEditWorkspace = can(workspace.role, "workspace.settings");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your workspace, your business details and your own profile.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Catalogue link:{" "}
            <span className="font-mono">/store/{workspace.slug}</span>
          </p>
        </CardHeader>
        <CardContent>
          <WorkspaceSettingsForm
            canEdit={canEditWorkspace}
            defaults={{
              name: workspace.name,
              currency: workspace.currency,
              isCataloguePublic: workspace.isCataloguePublic,
              businessName: business?.business_name ?? workspace.name,
              category: business?.category ?? "other",
              primaryChannel: business?.primary_channel ?? "whatsapp",
              city: business?.city ?? "",
              whatsappNumber: business?.whatsapp_number ?? "",
              description: business?.description ?? "",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileSettingsForm
            fullName={profile?.full_name ?? ""}
            preferredLanguage={profile?.preferred_language ?? "en"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People in this workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Inviting teammates arrives with the team module.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(members ?? []).map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-sm">
                  {member.user_id === user.id
                    ? `${profile?.full_name || user.email} (you)`
                    : "Teammate"}
                </span>
                <Badge variant="secondary">
                  {ROLE_LABELS[member.role as WorkspaceRole] ?? member.role}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
