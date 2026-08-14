import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  Loader,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  CHANNEL_STATE_LABELS,
  type ChannelState,
} from "@/features/integrations/status";

/**
 * The status pill.
 *
 * There is exactly one way to render "Connected" and it is driven by
 * `ChannelState`, which only ever carries that value when the deployment is
 * configured and the row has a real provider account id.
 *
 * Colour is never the only signal - each state has its own icon and its own
 * word - so the pill reads the same to someone who cannot tell the hues apart.
 * The label itself stays on a full-contrast token in both themes; the tint and
 * the icon are the decoration on top.
 */

type Tone = "success" | "warning" | "danger" | "neutral";

const TONE_CLASSES: Record<Tone, { badge: string; icon: string }> = {
  success: {
    badge: "border-success/40 bg-success/15 text-foreground",
    icon: "text-success",
  },
  warning: {
    badge: "border-warning/50 bg-warning/20 text-foreground",
    icon: "text-warning",
  },
  danger: {
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: "text-destructive",
  },
  neutral: {
    badge: "border-border bg-muted text-muted-foreground",
    icon: "text-muted-foreground",
  },
};

const STATE_PRESENTATION: Record<
  ChannelState,
  { tone: Tone; icon: LucideIcon }
> = {
  connected: { tone: "success", icon: CircleCheck },
  setup_required: { tone: "warning", icon: CircleAlert },
  pending: { tone: "warning", icon: Loader },
  error: { tone: "danger", icon: CircleAlert },
  disconnected: { tone: "neutral", icon: CircleSlash },
  not_configured: { tone: "neutral", icon: CircleDashed },
};

export function ChannelStatusBadge({ state }: { state: ChannelState | null }) {
  // Null is an unknown status, which is its own honest answer - neither
  // "connected" nor "not connected".
  const presentation = state
    ? STATE_PRESENTATION[state]
    : { tone: "neutral" as const, icon: CircleHelp };
  const tone = TONE_CLASSES[presentation.tone];
  const Icon = presentation.icon;
  const label = state ? CHANNEL_STATE_LABELS[state] : "Status unavailable";

  return (
    <Badge variant="outline" className={`h-6 gap-1.5 px-2.5 ${tone.badge}`}>
      <Icon className={`size-3 ${tone.icon}`} aria-hidden="true" />
      {label}
    </Badge>
  );
}
