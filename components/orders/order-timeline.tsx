import { formatDateTime } from "@/components/orders/formatting";
import type { TimelineEvent } from "@/features/orders/queries";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<TimelineEvent["tone"], string> = {
  default: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/**
 * Activity on the order, newest first. Every entry is derived from a stored
 * row or timestamp, so the timeline cannot show something that did not happen.
 */
export function OrderTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has happened on this order yet.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {events.map((event) => (
        <li key={event.key} className="flex gap-3">
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              TONE_CLASSES[event.tone],
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{event.title}</p>
            {event.detail ? (
              <p className="text-sm text-muted-foreground">{event.detail}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <time dateTime={event.at}>{formatDateTime(event.at)}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
