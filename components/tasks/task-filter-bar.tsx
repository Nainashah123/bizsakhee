import Link from "next/link";
import { Filter, X } from "lucide-react";

import { NativeSelect } from "@/components/tasks/task-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { WorkspaceMemberOption } from "@/features/tasks/queries";
import {
  TASK_VIEW_LABELS,
  TASK_VIEWS,
  type TaskView,
} from "@/lib/tasks/filters";
import {
  ALL_VALUE,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  taskFiltersToQuery,
  type TaskFilters,
} from "@/lib/validation/tasks";
import { cn } from "@/lib/utils";

const BASE_PATH = "/dashboard/tasks";

/**
 * View tabs and the assignee/priority filters.
 *
 * A Server Component on purpose: the tabs are ordinary links and the filters
 * are a `method="get"` form, so both work with JavaScript unavailable and both
 * survive a refresh, a bookmark or a shared URL.
 */
export function TaskFilterBar({
  filters,
  counts,
  members,
}: {
  filters: TaskFilters;
  counts: Record<TaskView, number>;
  members: WorkspaceMemberOption[];
}) {
  const hasFilters =
    filters.assignee !== ALL_VALUE || filters.priority !== ALL_VALUE;

  return (
    <div className="space-y-3">
      <nav aria-label="Follow-up views">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {TASK_VIEWS.map((view) => {
            const active = view === filters.view;
            const query = taskFiltersToQuery({ ...filters, view });
            return (
              <li key={view}>
                <Link
                  href={`${BASE_PATH}?${query}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {TASK_VIEW_LABELS[view]}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      active
                        ? "bg-primary-foreground/20"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {counts[view]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form
        method="get"
        action={BASE_PATH}
        className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="view" value={filters.view} />

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="assignee-filter" className="text-xs">
            Assigned to
          </Label>
          <NativeSelect
            id="assignee-filter"
            name="assignee"
            defaultValue={filters.assignee}
          >
            <option value={ALL_VALUE}>Everyone</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="priority-filter" className="text-xs">
            Priority
          </Label>
          <NativeSelect
            id="priority-filter"
            name="priority"
            defaultValue={filters.priority}
          >
            <option value={ALL_VALUE}>Any priority</option>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {TASK_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex gap-2">
          <Button type="submit" size="lg" variant="secondary">
            <Filter aria-hidden="true" />
            Apply
          </Button>
          {hasFilters ? (
            <Button asChild size="lg" variant="ghost">
              <Link href={`${BASE_PATH}?view=${filters.view}`}>
                <X aria-hidden="true" />
                Clear
              </Link>
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
