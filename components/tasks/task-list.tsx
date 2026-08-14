"use client";

import { useActionState, useOptimistic } from "react";
import { useFormStatus } from "react-dom";
import {
  Check,
  CircleCheckBig,
  Circle,
  Link2,
  Loader2,
  Pencil,
  RotateCcw,
  UserRound,
} from "lucide-react";

import { FormAlert } from "@/components/auth/form-parts";
import { DueBadge, PriorityBadge } from "@/components/tasks/task-badges";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  setTaskCompletionAction,
  type TaskFormState,
} from "@/features/tasks/actions";
import type {
  TaskListItem,
  TaskRelatedOption,
  WorkspaceMemberOption,
} from "@/features/tasks/queries";
import { TASK_VIEW_LABELS, type TaskView } from "@/lib/tasks/filters";
import { cn } from "@/lib/utils";

const EMPTY: TaskFormState = {};

type SharedProps = {
  members: WorkspaceMemberOption[];
  relatedOptions: TaskRelatedOption[];
  timeZone: string;
  now: Date;
  assigneeLabels: Map<string, string>;
  /** Roles without `tasks.write` get a read-only list rather than dead buttons. */
  canWrite: boolean;
};

/**
 * Completion state for one row.
 *
 * The tick flips immediately, but the Server Action is what actually decides:
 * if it fails, React discards the optimistic value and the row snaps back with
 * the error shown next to it.
 */
function useTaskCompletion(task: TaskListItem) {
  const [state, submit] = useActionState(setTaskCompletionAction, EMPTY);
  const [completed, setCompleted] = useOptimistic(task.status === "completed");

  function action(formData: FormData) {
    setCompleted(formData.get("completed") === "true");
    return submit(formData);
  }

  return { completed, action, error: state.error };
}

function ToggleButton({
  completed,
  title,
}: {
  completed: boolean;
  title: string;
}) {
  const { pending } = useFormStatus();
  const label = completed
    ? `Reopen follow-up: ${title}`
    : `Mark follow-up done: ${title}`;

  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={completed ? "Reopen" : "Mark done"}
      disabled={pending}
      aria-busy={pending}
      className={completed ? "text-success" : "text-muted-foreground"}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : completed ? (
        <CircleCheckBig aria-hidden="true" />
      ) : (
        <Circle aria-hidden="true" />
      )}
    </Button>
  );
}

function CompletionForm({
  task,
  completed,
  action,
  canWrite,
}: {
  task: TaskListItem;
  completed: boolean;
  action: (formData: FormData) => void;
  canWrite: boolean;
}) {
  if (!canWrite) {
    return (
      <span className="inline-flex size-9 items-center justify-center text-muted-foreground">
        {completed ? (
          <CircleCheckBig aria-label="Done" className="size-4" />
        ) : (
          <Circle aria-label="Still open" className="size-4" />
        )}
      </span>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="taskId" value={task.id} />
      {/* Submitting the opposite of what is on screen right now. */}
      <input
        type="hidden"
        name="completed"
        value={completed ? "false" : "true"}
      />
      <ToggleButton completed={completed} title={task.title} />
    </form>
  );
}

function RelatedLink({ task }: { task: TaskListItem }) {
  if (!task.related) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Link2 className="size-3" aria-hidden="true" />
      {task.related.label}
    </span>
  );
}

function EditTrigger({
  task,
  members,
  relatedOptions,
  timeZone,
  canWrite,
}: {
  task: TaskListItem;
} & Pick<SharedProps, "members" | "relatedOptions" | "timeZone" | "canWrite">) {
  if (!canWrite) return null;
  return (
    <TaskFormDialog
      task={task}
      members={members}
      relatedOptions={relatedOptions}
      timeZone={timeZone}
      trigger={
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={`Edit follow-up: ${task.title}`}
          title="Edit"
        >
          <Pencil aria-hidden="true" />
        </Button>
      }
    />
  );
}

function TaskCard({
  task,
  members,
  relatedOptions,
  timeZone,
  now,
  assigneeLabels,
  canWrite,
}: { task: TaskListItem } & SharedProps) {
  const { completed, action, error } = useTaskCompletion(task);
  const assignee = task.assignedTo
    ? (assigneeLabels.get(task.assignedTo) ?? "Teammate")
    : "Nobody yet";

  return (
    <li className="rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2">
        <CompletionForm
          task={task}
          completed={completed}
          action={action}
          canWrite={canWrite}
        />

        <div className="min-w-0 flex-1 space-y-2">
          <p
            className={cn(
              "text-sm font-medium break-words",
              completed && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </p>

          {task.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {task.description}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <DueBadge
              bucket={task.bucket}
              dueAt={task.dueAt}
              now={now}
              timeZone={timeZone}
            />
            <PriorityBadge priority={task.priority} />
            <RelatedLink task={task} />
          </div>

          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <UserRound className="size-3" aria-hidden="true" />
            {assignee}
          </p>

          {error ? <FormAlert variant="error">{error}</FormAlert> : null}
        </div>

        <EditTrigger
          task={task}
          members={members}
          relatedOptions={relatedOptions}
          timeZone={timeZone}
          canWrite={canWrite}
        />
      </div>
    </li>
  );
}

function TaskTableRow({
  task,
  members,
  relatedOptions,
  timeZone,
  now,
  assigneeLabels,
  canWrite,
}: { task: TaskListItem } & SharedProps) {
  const { completed, action, error } = useTaskCompletion(task);
  const assignee = task.assignedTo
    ? (assigneeLabels.get(task.assignedTo) ?? "Teammate")
    : "Nobody yet";

  return (
    <TableRow>
      <TableCell className="w-12">
        <CompletionForm
          task={task}
          completed={completed}
          action={action}
          canWrite={canWrite}
        />
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <p
            className={cn(
              "font-medium",
              completed && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </p>
          {task.description ? (
            <p className="line-clamp-1 max-w-prose text-sm text-muted-foreground">
              {task.description}
            </p>
          ) : null}
          <RelatedLink task={task} />
          {error ? <FormAlert variant="error">{error}</FormAlert> : null}
        </div>
      </TableCell>
      <TableCell>
        <DueBadge
          bucket={task.bucket}
          dueAt={task.dueAt}
          now={now}
          timeZone={timeZone}
        />
      </TableCell>
      <TableCell>
        <PriorityBadge priority={task.priority} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {assignee}
      </TableCell>
      <TableCell className="w-12 text-right">
        <EditTrigger
          task={task}
          members={members}
          relatedOptions={relatedOptions}
          timeZone={timeZone}
          canWrite={canWrite}
        />
      </TableCell>
    </TableRow>
  );
}

const EMPTY_COPY: Record<TaskView, { title: string; body: string }> = {
  due_today: {
    title: "Nothing due today",
    body: "Your day is clear. Add the next person you owe a reply to and it will show up here.",
  },
  overdue: {
    title: "Nothing overdue",
    body: "Every follow-up is still within its date. Add another one to keep the momentum.",
  },
  upcoming: {
    title: "Nothing planned yet",
    body: "Give a follow-up a date in the next few days so it finds you instead of the other way round.",
  },
  no_date: {
    title: "Everything has a date",
    body: "No loose follow-ups. Add one without a date when you only know it needs doing eventually.",
  },
  completed: {
    title: "Nothing finished yet",
    body: "Follow-ups you tick off land here, so you can see what the week actually took.",
  },
};

function EmptyState({
  view,
  members,
  relatedOptions,
  timeZone,
  defaultAssignee,
  canWrite,
}: {
  view: TaskView;
  defaultAssignee?: string | null;
} & Pick<SharedProps, "members" | "relatedOptions" | "timeZone" | "canWrite">) {
  const copy = EMPTY_COPY[view];
  return (
    <div className="rounded-xl border border-dashed bg-card p-8 text-center">
      <h2 className="text-base font-semibold">{copy.title}</h2>
      <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
        {copy.body}
      </p>
      {canWrite ? (
        <div className="mt-4 flex justify-center">
          <TaskFormDialog
            members={members}
            relatedOptions={relatedOptions}
            timeZone={timeZone}
            defaultAssignee={defaultAssignee}
            trigger={
              <Button size="lg">
                <Check aria-hidden="true" />
                Add a follow-up
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

export function TaskList({
  tasks,
  view,
  hasMore,
  members,
  relatedOptions,
  timeZone,
  nowIso,
  defaultAssignee,
  canWrite,
}: {
  tasks: TaskListItem[];
  view: TaskView;
  hasMore: boolean;
  members: WorkspaceMemberOption[];
  relatedOptions: TaskRelatedOption[];
  timeZone: string;
  /** Reference instant chosen on the server, so both renders agree. */
  nowIso: string;
  defaultAssignee?: string | null;
  canWrite: boolean;
}) {
  const now = new Date(nowIso);
  const assigneeLabels = new Map(
    members.map((member) => [member.userId, member.label]),
  );
  const shared: SharedProps = {
    members,
    relatedOptions,
    timeZone,
    now,
    assigneeLabels,
    canWrite,
  };

  if (tasks.length === 0) {
    return (
      <EmptyState
        view={view}
        members={members}
        relatedOptions={relatedOptions}
        timeZone={timeZone}
        defaultAssignee={defaultAssignee}
        canWrite={canWrite}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3 lg:hidden">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} {...shared} />
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">Done</span>
              </TableHead>
              <TableHead>Follow-up</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TaskTableRow key={task.id} task={task} {...shared} />
            ))}
          </TableBody>
        </Table>
      </div>

      {hasMore ? (
        <p className="text-sm text-muted-foreground">
          Showing the first {tasks.length} in {TASK_VIEW_LABELS[view]}. Narrow
          the list with the filters above to see the rest.
        </p>
      ) : null}

      {canWrite ? (
        <p className="text-xs text-muted-foreground">
          <RotateCcw className="mr-1 inline size-3" aria-hidden="true" />
          Ticking a follow-up saves straight away; reopening one puts its
          reminder back in the queue.
        </p>
      ) : null}
    </div>
  );
}
