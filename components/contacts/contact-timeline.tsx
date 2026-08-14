import {
  ListTodo,
  MessageSquare,
  Receipt,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  TimelineEntry,
  TimelineEntryType,
} from "@/features/contacts/queries";

const TYPE_META: Record<
  TimelineEntryType,
  { label: string; icon: LucideIcon }
> = {
  note: { label: "Note", icon: StickyNote },
  task: { label: "Follow-up", icon: ListTodo },
  order: { label: "Order", icon: Receipt },
  message: { label: "Message", icon: MessageSquare },
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Notes, follow-ups, orders and messages in one list, newest first. Each row
 * carries the type it came from, because the four tables are merged only here.
 */
export function ContactTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has happened yet. Add a note above and it appears here straight
        away, alongside orders, follow-ups and messages.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {entries.map((entry) => {
        const meta = TYPE_META[entry.type];
        const Icon = meta.icon;
        return (
          <li key={entry.id} className="flex gap-3">
            <span
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"
              aria-hidden="true"
            >
              <Icon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{meta.label}</Badge>
                <p className="text-sm font-medium">{entry.title}</p>
                <time
                  dateTime={entry.at}
                  className="text-xs text-muted-foreground"
                >
                  {formatWhen(entry.at)}
                </time>
              </div>
              {entry.detail ? (
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {entry.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
