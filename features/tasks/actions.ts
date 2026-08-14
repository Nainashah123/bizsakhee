"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { fromZonedInputValues } from "@/lib/tasks/filters";
import { parseFormData } from "@/lib/validation/form";
import {
  taskCompletionSchema,
  taskInputSchema,
  type RelatedRef,
} from "@/lib/validation/tasks";

/**
 * Follow-up mutations.
 *
 * Every action starts with `requireCapability("tasks.write")`, which resolves
 * the workspace from the session - the workspace id is never read from the
 * form. Assignees and linked records are re-checked against that workspace, so
 * a crafted form cannot attach a task to another tenant's contact or hand it to
 * someone who is not a member.
 */

export type TaskFormState = {
  status?: "saved" | "error";
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  /** Id of the row just written, so the client can scroll or highlight it. */
  taskId?: string;
};

const SAVE_FAILED = "We could not save that follow-up. Please try again.";

function invalid(
  message: string,
  fieldErrors?: Record<string, string[]>,
): TaskFormState {
  return { status: "error", error: message, fieldErrors };
}

/** Confirms the chosen assignee really is a member of this workspace. */
async function assertMember(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Confirms the linked record belongs to this workspace.
 *
 * Written as a switch rather than a dynamic table name so each query keeps its
 * generated row type - and so a future table can never be reached by accident.
 */
async function assertRelated(
  workspaceId: string,
  related: RelatedRef,
): Promise<boolean> {
  const supabase = await createClient();

  switch (related.kind) {
    case "contact": {
      const { data } = await supabase
        .from("contacts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", related.id)
        .maybeSingle();
      return Boolean(data);
    }
    case "order": {
      const { data } = await supabase
        .from("orders")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", related.id)
        .maybeSingle();
      return Boolean(data);
    }
    case "opportunity": {
      const { data } = await supabase
        .from("opportunities")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", related.id)
        .maybeSingle();
      return Boolean(data);
    }
  }
}

function relatedColumns(related: RelatedRef | null) {
  return {
    contact_id: related?.kind === "contact" ? related.id : null,
    order_id: related?.kind === "order" ? related.id : null,
    opportunity_id: related?.kind === "opportunity" ? related.id : null,
  };
}

/**
 * Creates a follow-up, or updates one when `taskId` is present.
 *
 * The due date arrives as separate date and time fields and is read as
 * wall-clock time in the *workspace* timezone - "12 March, 18:30" means 18:30
 * where the business is, not on whichever host happens to run the action.
 */
export async function saveTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const authorized = await requireCapability("tasks.write");
  if (!authorized.ok) return invalid(authorized.error.message);

  const parsed = parseFormData(taskInputSchema, formData);
  if (!parsed.ok) {
    return invalid(parsed.error.message, parsed.error.fieldErrors);
  }

  const { workspace, user } = authorized.data;
  const input = parsed.data;

  let dueAt: string | null = null;
  if (input.dueDate) {
    const instant = fromZonedInputValues(
      input.dueDate,
      input.dueTime,
      workspace.timezone,
    );
    if (!instant) {
      return invalid("Please check the highlighted fields.", {
        dueDate: ["That is not a real date"],
      });
    }
    dueAt = instant.toISOString();
  }

  if (
    input.assignedTo &&
    !(await assertMember(workspace.id, input.assignedTo))
  ) {
    return invalid("Please check the highlighted fields.", {
      assignedTo: ["That person is not in this workspace"],
    });
  }

  if (
    input.relatedTo &&
    !(await assertRelated(workspace.id, input.relatedTo))
  ) {
    return invalid("Please check the highlighted fields.", {
      relatedTo: ["We could not find that record"],
    });
  }

  const supabase = await createClient();

  const values = {
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    due_at: dueAt,
    assigned_to: input.assignedTo ?? null,
    ...relatedColumns(input.relatedTo),
  };

  if (input.taskId) {
    const { data, error } = await supabase
      .from("tasks")
      .update(values)
      .eq("id", input.taskId)
      .eq("workspace_id", workspace.id)
      .select("id")
      .maybeSingle();

    if (error) {
      logger.error("task_update_failed", { code: error.code });
      return invalid(SAVE_FAILED);
    }
    if (!data) {
      return invalid("That follow-up no longer exists.");
    }

    revalidatePath("/dashboard/tasks");
    revalidatePath("/dashboard");
    return { status: "saved", message: "Follow-up updated.", taskId: data.id };
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      workspace_id: workspace.id,
      created_by: user.id,
      status: "open",
      ...values,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("task_insert_failed", { code: error.code });
    return invalid(SAVE_FAILED);
  }

  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard");
  return {
    status: "saved",
    message: "Follow-up added.",
    taskId: data?.id,
  };
}

/**
 * Marks a follow-up done, or reopens it.
 *
 * Reopening also clears `reminder_sent_at` so the reminders cron can notify the
 * assignee again - otherwise a reopened task would never chase anybody.
 */
export async function setTaskCompletionAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const authorized = await requireCapability("tasks.write");
  if (!authorized.ok) return invalid(authorized.error.message);

  const parsed = parseFormData(taskCompletionSchema, formData);
  if (!parsed.ok)
    return invalid(parsed.error.message, parsed.error.fieldErrors);

  const { workspace } = authorized.data;
  const { taskId, completed } = parsed.data;
  const supabase = await createClient();

  const values = completed
    ? { status: "completed" as const, completed_at: new Date().toISOString() }
    : {
        status: "open" as const,
        completed_at: null,
        reminder_sent_at: null,
      };

  const { data, error } = await supabase
    .from("tasks")
    .update(values)
    .eq("id", taskId)
    .eq("workspace_id", workspace.id)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("task_completion_update_failed", { code: error.code });
    return invalid("We could not update that follow-up. Please try again.");
  }
  if (!data) return invalid("That follow-up no longer exists.");

  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard");
  return {
    status: "saved",
    message: completed ? "Marked done." : "Reopened.",
    taskId: data.id,
  };
}
