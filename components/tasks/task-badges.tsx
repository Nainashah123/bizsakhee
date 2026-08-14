import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarOff,
  CalendarRange,
  Minus,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { TaskPriority } from "@/lib/supabase/database.types";
import { formatDueLabel, type TaskDueBucket } from "@/lib/tasks/filters";
import { TASK_PRIORITY_LABELS } from "@/lib/validation/tasks";

/**
 * Small presentational pieces shared by the cards and the table.
 *
 * Red is reserved for genuine problems, so only "overdue" uses the destructive
 * token; a high priority uses the accent instead.
 */

const PRIORITY_STYLES: Record<
  TaskPriority,
  { icon: LucideIcon; className: string }
> = {
  high: { icon: ArrowUp, className: "border-accent/50 text-accent" },
  normal: { icon: Minus, className: "text-muted-foreground" },
  low: { icon: ArrowDown, className: "text-muted-foreground" },
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { icon: Icon, className } = PRIORITY_STYLES[priority];
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden="true" />
      {TASK_PRIORITY_LABELS[priority]} priority
    </Badge>
  );
}

const BUCKET_STYLES: Record<
  TaskDueBucket,
  { icon: LucideIcon; className: string }
> = {
  overdue: {
    icon: AlertTriangle,
    className: "border-destructive/40 text-destructive",
  },
  due_today: {
    icon: CalendarClock,
    className: "border-warning/50 text-warning",
  },
  upcoming: { icon: CalendarRange, className: "text-muted-foreground" },
  no_date: { icon: CalendarOff, className: "text-muted-foreground" },
};

export function DueBadge({
  bucket,
  dueAt,
  now,
  timeZone,
}: {
  bucket: TaskDueBucket;
  dueAt: string | null;
  now: Date;
  timeZone: string;
}) {
  const { icon: Icon, className } = BUCKET_STYLES[bucket];
  const label = formatDueLabel(dueAt, now, timeZone);

  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden="true" />
      {bucket === "overdue" ? `Overdue · ${label}` : label}
    </Badge>
  );
}
