import { CircleAlert, Gauge, Sparkles } from "lucide-react";

import { formatQuota, type AiQuotaView } from "@/components/ai/options";
import { Progress } from "@/components/ui/progress";

/**
 * The standing notices around the AI tools.
 *
 * These are permanent, not dismissible. A seller should never be unsure whether
 * a machine wrote the words she is about to send to a customer.
 */

export function AiDisclaimer() {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-accent" aria-hidden="true" />
        Everything below is AI-generated
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>
          Read every draft before you send or post it. It is a starting point,
          not a finished message.
        </li>
        <li>
          The AI only knows what you type into the form. Check any price,
          delivery time or stock claim against your own records.
        </li>
        <li>
          It will not give financial, legal or medical advice, and neither
          should a draft you send. Point those questions to a professional.
        </li>
        <li>Nothing here is sent to anyone. You copy it and send it yourself.</li>
      </ul>
    </div>
  );
}

/**
 * Shown when the deployment runs the mock provider. The drafts it produces are
 * fill-in-the-blank templates, not a model's writing, and saying so is the only
 * honest option.
 */
export function SampleModeNotice() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        This deployment is running the offline sample provider, so no real model
        is called. The drafts below are canned templates with blanks to fill in.
      </span>
    </p>
  );
}

export function QuotaNote({
  quota,
  failed = false,
}: {
  quota: AiQuotaView;
  failed?: boolean;
}) {
  if (failed) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Gauge className="size-4" aria-hidden="true" />
        We could not read your AI allowance just now.
      </p>
    );
  }

  const percent =
    quota.limit === null || quota.limit <= 0
      ? 0
      : Math.min(100, Math.round((quota.used / quota.limit) * 100));

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Gauge className="size-4" aria-hidden="true" />
        {formatQuota(quota)}
      </p>
      {quota.limit === null ? null : (
        <Progress
          value={percent}
          aria-label={`AI drafts used this month: ${quota.used} of ${quota.limit}`}
        />
      )}
    </div>
  );
}
