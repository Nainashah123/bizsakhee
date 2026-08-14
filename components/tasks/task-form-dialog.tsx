"use client";

import { useActionState, useId, useState } from "react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { NativeSelect } from "@/components/tasks/task-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveTaskAction, type TaskFormState } from "@/features/tasks/actions";
import type {
  TaskListItem,
  TaskRelatedOption,
  WorkspaceMemberOption,
} from "@/features/tasks/queries";
import { toZonedInputValues } from "@/lib/tasks/filters";
import {
  NONE_VALUE,
  RELATED_KIND_LABELS,
  RELATED_KINDS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
} from "@/lib/validation/tasks";

const EMPTY: TaskFormState = {};

export type TaskFormDialogProps = {
  task?: TaskListItem;
  members: WorkspaceMemberOption[];
  relatedOptions: TaskRelatedOption[];
  timeZone: string;
  /** Pre-selected assignee for a brand new follow-up. */
  defaultAssignee?: string | null;
  trigger: React.ReactNode;
};

/**
 * Create and edit share one form. The dialog closes only once the Server Action
 * has confirmed the write - the server stays the source of truth.
 */
export function TaskFormDialog({
  task,
  members,
  relatedOptions,
  timeZone,
  defaultAssignee,
  trigger,
}: TaskFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, submit] = useActionState(saveTaskAction, EMPTY);
  const fieldId = useId();

  // Close on a successful save by reacting to the new action state during
  // render rather than in an effect, which would cause a cascading render.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "saved") setOpen(false);
  }

  const isEdit = Boolean(task);
  const due = toZonedInputValues(task?.dueAt ?? null, timeZone);

  // A task may point at a record outside the option window (only the most
  // recent are listed). Keep its own link selectable so editing the title
  // cannot quietly detach it.
  const options = [...relatedOptions];
  if (task?.related && !options.some((o) => o.value === task.related?.value)) {
    options.unshift({
      value: task.related.value,
      label: task.related.label,
      kind: task.related.kind,
    });
  }

  const id = (name: string) => `${fieldId}-${name}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit follow-up" : "New follow-up"}
          </DialogTitle>
          <DialogDescription>
            Times are read in your workspace timezone ({timeZone}).
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="space-y-4" noValidate>
          {task ? <input type="hidden" name="taskId" value={task.id} /> : null}

          <FormAlert variant="error">{state.error}</FormAlert>

          <div className="space-y-2">
            <Label htmlFor={id("title")}>Title</Label>
            <Input
              id={id("title")}
              name="title"
              className="h-11"
              defaultValue={task?.title ?? ""}
              maxLength={200}
              autoComplete="off"
              aria-describedby={id("title-error")}
            />
            <FieldError
              id={id("title-error")}
              messages={state.fieldErrors?.title}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={id("description")}>Notes</Label>
            <Textarea
              id={id("description")}
              name="description"
              rows={3}
              defaultValue={task?.description ?? ""}
              placeholder="What needs to happen, and anything you want to remember."
              aria-describedby={id("description-error")}
            />
            <FieldError
              id={id("description-error")}
              messages={state.fieldErrors?.description}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={id("dueDate")}>Due date</Label>
              <Input
                id={id("dueDate")}
                name="dueDate"
                type="date"
                className="h-11"
                defaultValue={due.date}
                aria-describedby={id("dueDate-error")}
              />
              <FieldError
                id={id("dueDate-error")}
                messages={state.fieldErrors?.dueDate}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={id("dueTime")}>Time</Label>
              <Input
                id={id("dueTime")}
                name="dueTime"
                type="time"
                className="h-11"
                defaultValue={due.time}
                aria-describedby={id("dueTime-hint")}
              />
              <p
                id={id("dueTime-hint")}
                className="text-xs text-muted-foreground"
              >
                Leave empty for end of day.
              </p>
              <FieldError
                id={id("dueTime-error")}
                messages={state.fieldErrors?.dueTime}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={id("priority")}>Priority</Label>
              <NativeSelect
                id={id("priority")}
                name="priority"
                defaultValue={task?.priority ?? "normal"}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {TASK_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={id("assignedTo")}>Assigned to</Label>
              <NativeSelect
                id={id("assignedTo")}
                name="assignedTo"
                defaultValue={task?.assignedTo ?? defaultAssignee ?? NONE_VALUE}
                aria-describedby={id("assignedTo-error")}
              >
                <option value={NONE_VALUE}>Nobody yet</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.label}
                  </option>
                ))}
              </NativeSelect>
              <FieldError
                id={id("assignedTo-error")}
                messages={state.fieldErrors?.assignedTo}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={id("relatedTo")}>Related to</Label>
            <NativeSelect
              id={id("relatedTo")}
              name="relatedTo"
              defaultValue={task?.related?.value ?? NONE_VALUE}
              aria-describedby={id("relatedTo-error")}
            >
              <option value={NONE_VALUE}>Nothing in particular</option>
              {RELATED_KINDS.map((kind) => {
                const group = options.filter((option) => option.kind === kind);
                if (!group.length) return null;
                return (
                  <optgroup key={kind} label={RELATED_KIND_LABELS[kind]}>
                    {group.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </NativeSelect>
            <FieldError
              id={id("relatedTo-error")}
              messages={state.fieldErrors?.relatedTo}
            />
          </div>

          <DialogFooter>
            <SubmitButton className="sm:w-auto sm:min-w-40">
              {isEdit ? "Save changes" : "Add follow-up"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
