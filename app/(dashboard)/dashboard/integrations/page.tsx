import type { Metadata } from "next";
import { CircleAlert, Lock } from "lucide-react";

import { ChannelCard } from "@/components/integrations/channel-card";
import { ChannelSetupChecklist } from "@/components/integrations/channel-setup-checklist";
import { DeepLinkNotice } from "@/components/integrations/deep-link-notice";
import { getChannelsOverview } from "@/features/integrations/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Channels" };

/**
 * Channels.
 *
 * The one screen where an honest answer matters more than a tidy one. There
 * are no Meta credentials on most deployments, and this page says so plainly:
 * which variables are missing, what is already in place, and that live
 * messaging additionally needs a human review at Meta.
 *
 * Everything is decided on the server. The workspace and the role come from
 * `requireWorkspace()`, the deployment state comes from `serverEnv()`, and the
 * status comes from `deriveChannelStatus`, where deployment configuration
 * outranks whatever a stored row happens to remember.
 */
export default async function IntegrationsPage() {
  const { workspace } = await requireWorkspace();

  // Server-resolved. The cards hide their controls to match, and the Server
  // Action checks the same capability again before it writes anything.
  const canManage = can(workspace.role, "integrations.manage");

  const overview = await getChannelsOverview({
    workspaceId: workspace.id,
    role: workspace.role,
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="text-sm text-muted-foreground">
          Where {workspace.name} talks to customers, and what is actually
          connected today.
        </p>
      </div>

      <DeepLinkNotice />

      {overview.readFailed ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
            <CircleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            We could not read your channel settings.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing has changed about your channels - this is a read that
            failed. Refresh the page to try again.
          </p>
        </div>
      ) : null}

      {overview.restricted ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border bg-muted/40 p-4"
        >
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Channel connection details are limited to owners and admins.
          </p>
          <p className="text-sm text-muted-foreground">
            Your role can see that channels exist but not how they are
            connected. Ask a workspace owner or admin if something looks wrong.
          </p>
        </div>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Meta channels
          </h2>
          <p className="text-sm text-muted-foreground">
            {overview.deploymentReady
              ? "Connect an account once and its messages arrive here from then on."
              : "These need a Meta app on this deployment. Until one is configured they cannot be connected - and we are not going to pretend otherwise."}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {overview.channels.map((channel) => (
            <ChannelCard
              key={channel.provider}
              channel={channel}
              canManage={canManage}
              deploymentReady={overview.deploymentReady}
            />
          ))}
        </div>
      </section>

      {overview.deploymentReady ? null : (
        <ChannelSetupChecklist
          meta={overview.meta}
          encryption={overview.encryption}
        />
      )}
    </div>
  );
}
