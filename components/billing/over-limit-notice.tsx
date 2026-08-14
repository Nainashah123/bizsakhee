import { CircleAlert } from "lucide-react";

import type { UsageMeter } from "@/features/billing/queries";
import { formatLimit, getPlan, type Plan } from "@/lib/plans";

/**
 * Shown when a workspace is at or over a limit - usually after a downgrade.
 *
 * The message is deliberately specific: which limit, what the cap is, and which
 * plan raises it. Nothing is ever deleted for being over a limit; only creating
 * more is blocked.
 */
export function OverLimitNotice({
  blocked,
  plan,
}: {
  blocked: UsageMeter[];
  plan: Plan;
}) {
  if (blocked.length === 0) return null;

  return (
    <div
      role="status"
      className="space-y-3 rounded-xl border border-warning/50 bg-warning/10 p-4"
    >
      <p className="flex items-start gap-2 text-sm font-semibold text-warning-foreground">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        You are at the limit of your {plan.name} plan.
      </p>

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        {blocked.map((meter) => {
          const upgrade = meter.upgradeTo ? getPlan(meter.upgradeTo) : null;
          return (
            <li key={meter.key}>
              <span className="font-medium text-foreground">
                {meter.label}: {meter.used} of {formatLimit(meter.limit)} used.
              </span>{" "}
              {upgrade
                ? `${upgrade.name} raises this to ${formatLimit(upgrade.limits[meter.key])}.`
                : "This is already the largest plan we offer."}
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-muted-foreground">
        Everything you have already saved stays exactly as it is - nothing is
        deleted or hidden, and you can still edit and export it. Only adding new
        records past the limit is blocked until you upgrade or archive some.
      </p>
    </div>
  );
}
