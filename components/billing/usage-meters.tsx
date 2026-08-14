import { formatUsagePeriod } from "@/components/billing/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { UsageMeter } from "@/features/billing/queries";
import { formatLimit, getPlan } from "@/lib/plans";

/**
 * Honest usage meters.
 *
 * Every number is a server-side count. A workspace that is over its cap after a
 * downgrade shows a full bar and a plain explanation - the bar never goes past
 * 100%, and an uncapped limit shows "Unlimited" instead of a meaningless bar.
 */

const NUMBER = new Intl.NumberFormat("en-IN");

function UsageRow({ meter }: { meter: UsageMeter }) {
  const unlimited = meter.limit === null;
  const upgradePlan = meter.upgradeTo ? getPlan(meter.upgradeTo) : null;

  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{meter.label}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {unlimited
            ? `${NUMBER.format(meter.used)} used · Unlimited`
            : `${NUMBER.format(meter.used)} of ${formatLimit(meter.limit)}`}
        </span>
      </div>

      {unlimited ? (
        <p className="text-xs text-muted-foreground">
          No cap on this plan, under fair use.
        </p>
      ) : (
        <Progress
          value={meter.percent}
          aria-label={`${meter.label}: ${NUMBER.format(meter.used)} of ${formatLimit(
            meter.limit,
          )} used`}
          className={
            meter.atLimit
              ? "h-2 [&_[data-slot=progress-indicator]]:bg-warning"
              : "h-2"
          }
        />
      )}

      <p className="text-xs text-muted-foreground">{meter.helper}</p>

      {meter.atLimit ? (
        <p className="text-xs font-medium text-warning-foreground">
          {upgradePlan
            ? `You cannot add more ${meter.label.toLowerCase()} until you move to ${upgradePlan.name}, which allows ${formatLimit(
                upgradePlan.limits[meter.key],
              )}.`
            : `You have reached the largest plan for ${meter.label.toLowerCase()}. Get in touch and we will work out a fair-use arrangement.`}
        </p>
      ) : null}
    </li>
  );
}

export function UsageMeters({
  meters,
  period,
}: {
  meters: UsageMeter[];
  period: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <p className="text-sm text-muted-foreground">
          Counted on the server. AI drafts are counted for{" "}
          {formatUsagePeriod(period)} and reset at the start of each month.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-5">
          {meters.map((meter) => (
            <UsageRow key={meter.key} meter={meter} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
