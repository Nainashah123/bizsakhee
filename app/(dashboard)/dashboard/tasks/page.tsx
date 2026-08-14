import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";

import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { TaskQuickAdd } from "@/components/tasks/task-quick-add";
import { Button } from "@/components/ui/button";
import {
  getTaskRelatedOptions,
  getTasksForView,
  getTaskViewCounts,
  getWorkspaceMemberOptions,
} from "@/features/tasks/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import {
  resolveTimeZone,
  TASK_VIEW_LABELS,
  zonedDayKey,
} from "@/lib/tasks/filters";
import { parseTaskFilters, taskFiltersToQuery } from "@/lib/validation/tasks";

export const metadata: Metadata = { title: "Follow-ups" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user, workspace } = await requireWorkspace();
  const filters = parseTaskFilters(await searchParams);

  // One reference instant for the query, the badges and the client render, so
  // nothing can classify the same task two different ways mid-request.
  const now = new Date();
  const timeZone = resolveTimeZone(workspace.timezone);
  const canWrite = can(workspace.role, "tasks.write");

  const [members, relatedOptions, counts, page] = await Promise.all([
    getWorkspaceMemberOptions(workspace.id, user.id),
    getTaskRelatedOptions(workspace.id),
    getTaskViewCounts(workspace.id, filters, now, timeZone),
    getTasksForView(workspace.id, filters, now, timeZone),
  ]);

  const failure = [members, relatedOptions, counts, page].find(
    (result) => !result.ok,
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          Everything you promised someone you would do, in {timeZone} time.
        </p>
      </div>

      {canWrite && members.ok && relatedOptions.ok ? (
        <TaskFormDialog
          members={members.data}
          relatedOptions={relatedOptions.data}
          timeZone={timeZone}
          defaultAssignee={user.id}
          trigger={
            <Button size="lg">
              <Plus aria-hidden="true" />
              New follow-up
            </Button>
          }
        />
      ) : null}
    </div>
  );

  if (failure && !failure.ok) {
    return (
      <div className="space-y-6">
        {header}
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertCircle className="size-4" aria-hidden="true" />
            {failure.error.message}
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing was lost - this page only reads. Try again, and if it keeps
            failing the workspace database is unreachable.
          </p>
          <Button asChild variant="outline" size="lg">
            <Link href={`/dashboard/tasks?${taskFiltersToQuery(filters)}`}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!members.ok || !relatedOptions.ok || !counts.ok || !page.ok) return null;

  return (
    <div className="space-y-5">
      {header}

      {canWrite ? (
        <TaskQuickAdd
          defaultAssignee={user.id}
          defaultDueDate={zonedDayKey(now, timeZone)}
        />
      ) : null}

      <TaskFilterBar
        filters={filters}
        counts={counts.data}
        members={members.data}
      />

      <section aria-label={TASK_VIEW_LABELS[filters.view]}>
        <TaskList
          tasks={page.data.tasks}
          view={filters.view}
          hasMore={page.data.hasMore}
          members={members.data}
          relatedOptions={relatedOptions.data}
          timeZone={timeZone}
          nowIso={now.toISOString()}
          defaultAssignee={user.id}
          canWrite={canWrite}
        />
      </section>
    </div>
  );
}
