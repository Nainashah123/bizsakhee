import {
  CircleAlert,
  Instagram,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

import { ChannelStatusBadge } from "@/components/integrations/channel-status-badge";
import { ConnectChannelButton } from "@/components/integrations/connect-channel-button";
import { DisconnectChannelButton } from "@/components/integrations/disconnect-channel-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChannelSummary } from "@/features/integrations/queries";
import {
  ACCOUNT_ID_LABELS,
  CHANNEL_LABELS,
  type ChannelProvider,
} from "@/features/integrations/status";

/**
 * One provider card.
 *
 * The card renders exactly what `deriveChannelStatus` decided and adds nothing.
 * In particular there is no branch anywhere in here that can produce a
 * "Connected" pill from a row alone - the derivation already refused to hand
 * one over unless the deployment could really reach Meta.
 */

const CHANNEL_ICONS: Record<ChannelProvider, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
};

const CHANNEL_BLURBS: Record<ChannelProvider, string> = {
  whatsapp:
    "Receive and reply to WhatsApp messages inside BizSakhi, with every conversation attached to the customer it belongs to.",
  instagram:
    "Pull Instagram DMs into the same inbox, so a question about a photo becomes an order without leaving the app.",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function ChannelCard({
  channel,
  canManage,
  deploymentReady,
}: {
  channel: ChannelSummary;
  /** Server-resolved `integrations.manage`. Hiding is never the check. */
  canManage: boolean;
  /** False when this deployment has no usable Meta app. */
  deploymentReady: boolean;
}) {
  const { provider, status } = channel;
  const Icon = CHANNEL_ICONS[provider];
  const connectedOn = formatDate(status?.connectedAt ?? null);

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="truncate">
                {CHANNEL_LABELS[provider]}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {CHANNEL_BLURBS[provider]}
              </p>
            </div>
          </div>
          <ChannelStatusBadge state={status?.state ?? null} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {status ? (
          status.state === "error" ? (
            <div
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
            >
              <p className="flex items-start gap-2 text-sm font-medium text-destructive">
                <CircleAlert
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                Meta rejected the last exchange on this channel.
              </p>
              {/* Redacted upstream, in `redactProviderError`. Tokens, emails
                  and phone numbers never reach this line. */}
              <p className="text-sm break-words text-muted-foreground">
                {status.reason}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{status.reason}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            We could not read this channel&rsquo;s connection status just now,
            so we are not going to guess at it. Refresh in a moment.
          </p>
        )}

        {status?.connected ? (
          <dl className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
            {status.accountLabel ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Account</dt>
                <dd className="font-medium break-all">{status.accountLabel}</dd>
              </div>
            ) : null}
            {status.accountId ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">
                  {ACCOUNT_ID_LABELS[provider]}
                </dt>
                <dd className="font-mono text-xs break-all">
                  {status.accountId}
                </dd>
              </div>
            ) : null}
            {connectedOn ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Connected</dt>
                <dd className="font-medium">{connectedOn}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            {status?.connected ? (
              <DisconnectChannelButton provider={provider} />
            ) : (
              <ConnectChannelButton
                provider={provider}
                // Pressing this could not possibly succeed without a Meta app,
                // so it is disabled rather than offered and then refused.
                disabled={!deploymentReady}
                label={
                  status?.state === "error"
                    ? "Try connecting again"
                    : status?.state === "disconnected" ||
                        status?.state === "pending"
                      ? "Connect again"
                      : undefined
                }
              />
            )}
          </div>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Only a workspace owner or admin can connect or disconnect channels.
            You can see the status here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
