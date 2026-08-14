import Link from "next/link";
import { CalendarDays, CircleDot, Trophy, XCircle } from "lucide-react";

import { MoveStageForm } from "@/components/pipeline/move-stage-form";
import { Badge } from "@/components/ui/badge";
import type { PipelineBoard as Board } from "@/features/pipeline/queries";
import { formatMoney, isCurrencyCode } from "@/lib/money";

function money(minor: number, currency: string): string {
  return formatMoney(minor, isCurrencyCode(currency) ? currency : "INR");
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Stages as columns from `lg`, stacked on phones. Every card carries a "Move to
 * stage" select, so the board is fully usable without dragging anything.
 */
export function PipelineBoard({
  board,
  currency,
}: {
  board: Board;
  currency: string;
}) {
  const stageOptions = board.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {board.stages.map((stage) => {
        const StageIcon = stage.isWon
          ? Trophy
          : stage.isLost
            ? XCircle
            : CircleDot;

        return (
          <section
            key={stage.id}
            aria-labelledby={`stage-${stage.id}`}
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
          >
            <header className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h2
                  id={`stage-${stage.id}`}
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <StageIcon
                    className={
                      stage.isWon
                        ? "size-4 text-success"
                        : stage.isLost
                          ? "size-4 text-muted-foreground"
                          : "size-4 text-primary"
                    }
                    aria-hidden="true"
                  />
                  {stage.name}
                </h2>
                <Badge variant="secondary">{stage.opportunities.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {money(stage.totalValueMinor, currency)} in this stage
              </p>
            </header>

            {stage.opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deals here yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {stage.opportunities.map((deal) => {
                  const closeOn = formatDate(deal.expectedCloseOn);
                  return (
                    <li
                      key={deal.id}
                      className="space-y-2 rounded-lg border bg-background p-3"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{deal.title}</p>
                        <p className="text-sm text-muted-foreground tabular-nums">
                          {money(deal.valueMinor, deal.currency)}
                        </p>
                        {deal.contactId && deal.contactName ? (
                          <Link
                            href={`/dashboard/contacts/${deal.contactId}`}
                            className="inline-block text-sm text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {deal.contactName}
                          </Link>
                        ) : null}
                        {closeOn ? (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarDays
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            Expected {closeOn}
                          </p>
                        ) : null}
                      </div>

                      <MoveStageForm
                        opportunityId={deal.id}
                        title={deal.title}
                        currentStageId={stage.id}
                        stages={stageOptions}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
