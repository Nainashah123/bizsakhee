"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";

import { FieldError, FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTaskAction, type TaskFormState } from "@/features/tasks/actions";
import { NONE_VALUE } from "@/lib/validation/tasks";

const EMPTY: TaskFormState = {};

function QuickSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="h-11 w-full sm:w-auto"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Plus aria-hidden="true" />
      )}
      Add
    </Button>
  );
}

/**
 * Compact "type it and go" form, pinned above the list.
 *
 * Pressing `n` anywhere on the page (outside a field) moves focus here, so the
 * whole flow is reachable without a pointer. The form clears itself only after
 * the Server Action confirms the write.
 */
export function TaskQuickAdd({
  defaultAssignee,
  defaultDueDate,
}: {
  defaultAssignee?: string | null;
  /** Today in the workspace zone, so "Add" defaults to something sensible. */
  defaultDueDate: string;
}) {
  const [state, submit] = useActionState(saveTaskAction, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  useEffect(() => {
    if (state.status !== "saved") return;
    formRef.current?.reset();
    titleRef.current?.focus();
  }, [state]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "n" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      titleRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      ref={formRef}
      action={submit}
      className="space-y-3 rounded-xl border bg-card p-3"
      aria-label="Quick add a follow-up"
      noValidate
    >
      <input
        type="hidden"
        name="assignedTo"
        value={defaultAssignee ?? NONE_VALUE}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${fieldId}-title`} className="text-xs">
            Quick add{" "}
            <span className="font-normal text-muted-foreground">(press n)</span>
          </Label>
          <Input
            ref={titleRef}
            id={`${fieldId}-title`}
            name="title"
            className="h-11"
            placeholder="Call Meera about the saree order"
            maxLength={200}
            autoComplete="off"
            aria-describedby={`${fieldId}-title-error`}
          />
        </div>

        <div className="space-y-1.5 sm:w-44">
          <Label htmlFor={`${fieldId}-dueDate`} className="text-xs">
            Due
          </Label>
          <Input
            id={`${fieldId}-dueDate`}
            name="dueDate"
            type="date"
            className="h-11"
            defaultValue={defaultDueDate}
            aria-describedby={`${fieldId}-dueDate-error`}
          />
        </div>

        <QuickSubmit />
      </div>

      <FieldError
        id={`${fieldId}-title-error`}
        messages={state.fieldErrors?.title}
      />
      <FieldError
        id={`${fieldId}-dueDate-error`}
        messages={state.fieldErrors?.dueDate}
      />
      <FormAlert variant="error">{state.error}</FormAlert>
    </form>
  );
}
