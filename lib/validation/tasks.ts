import { z } from "zod";

import { DEFAULT_TASK_VIEW, TASK_VIEWS } from "@/lib/tasks/filters";
import type { TaskPriority } from "@/lib/supabase/database.types";

/**
 * Zod schemas for the follow-ups module.
 *
 * Only fields declared here survive `parseFormData`, so a crafted form cannot
 * reach a column it has no business writing - `workspace_id`, `created_by`,
 * `completed_at` and `reminder_sent_at` are all set server-side.
 */

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

/** Sentinel used by the selects, because a `<select>` cannot hold `undefined`. */
export const NONE_VALUE = "none";

/** Also used by the filter bar, where it means "no filter". */
export const ALL_VALUE = "all";

export const RELATED_KINDS = ["contact", "order", "opportunity"] as const;
export type RelatedKind = (typeof RELATED_KINDS)[number];

export const RELATED_KIND_LABELS: Record<RelatedKind, string> = {
  contact: "Customer",
  order: "Order",
  opportunity: "Deal",
};

export type RelatedRef = { kind: RelatedKind; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RELATED_REF = new RegExp(
  `^(${RELATED_KINDS.join("|")}):(${UUID.source.slice(1, -1)})$`,
  "i",
);

/** `"contact:<uuid>"` -> `{ kind, id }`. Returns null for "none" or rubbish. */
export function parseRelatedRef(
  value: string | null | undefined,
): RelatedRef | null {
  if (!value) return null;
  const match = RELATED_REF.exec(value.trim());
  if (!match) return null;
  return { kind: match[1].toLowerCase() as RelatedKind, id: match[2] };
}

export function formatRelatedRef(kind: RelatedKind, id: string): string {
  return `${kind}:${id}`;
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : undefined));

/** An optional member id: "", absent or the "none" sentinel all mean nobody. */
const optionalMemberId = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) =>
      value === undefined ||
      value === "" ||
      value === NONE_VALUE ||
      UUID.test(value),
    "Pick a teammate from the list",
  )
  .transform((value) =>
    value && value !== NONE_VALUE && UUID.test(value) ? value : undefined,
  );

const optionalRelatedRef = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) =>
      value === undefined ||
      value === "" ||
      value === NONE_VALUE ||
      RELATED_REF.test(value),
    "Pick a record from the list",
  )
  .transform((value) => parseRelatedRef(value));

const dueDate = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Use a date like 2026-03-12",
  )
  .transform((value) => (value ? value : undefined));

const dueTime = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^\d{2}:\d{2}(:\d{2})?$/.test(value),
    "Use a time like 18:30",
  )
  .transform((value) => (value ? value : undefined));

/**
 * Create and edit share one schema: an edit simply carries `taskId`. The due
 * date arrives as separate date and time fields and is combined into an instant
 * by the Server Action, which is the only place that knows the workspace zone.
 */
export const taskInputSchema = z
  .object({
    taskId: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || UUID.test(value), "Unknown follow-up")
      .transform((value) => (value ? value : undefined)),
    title: z
      .string()
      .trim()
      .min(1, "Give this follow-up a title")
      .max(200, "Keep the title under 200 characters"),
    description: optionalText(2000, "Keep the note under 2000 characters"),
    priority: z
      .enum(TASK_PRIORITIES, { message: "Pick a priority" })
      .default("normal"),
    dueDate,
    dueTime,
    assignedTo: optionalMemberId,
    relatedTo: optionalRelatedRef,
  })
  .superRefine((value, ctx) => {
    if (value.dueTime && !value.dueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Pick a date to go with that time",
      });
    }
  });

export type TaskInput = z.output<typeof taskInputSchema>;

export const taskCompletionSchema = z.object({
  taskId: z.string().trim().regex(UUID, "Unknown follow-up"),
  completed: z
    .enum(["true", "false"], { message: "Unknown action" })
    .transform((value) => value === "true"),
});

export type TaskCompletionInput = z.output<typeof taskCompletionSchema>;

/**
 * URL filter state. Every field uses `.catch` so a hand-edited query string
 * renders the default view instead of throwing inside a Server Component.
 */
export const taskFiltersSchema = z.object({
  view: z.enum(TASK_VIEWS).catch(DEFAULT_TASK_VIEW),
  assignee: z
    .string()
    .trim()
    .refine((value) => value === ALL_VALUE || UUID.test(value))
    .catch(ALL_VALUE),
  priority: z.enum([ALL_VALUE, ...TASK_PRIORITIES]).catch(ALL_VALUE),
});

export type TaskFilters = z.output<typeof taskFiltersSchema>;

type SearchParamValue = string | string[] | undefined;

/** Narrows Next.js `searchParams` into typed, always-valid filter state. */
export function parseTaskFilters(
  searchParams: Record<string, SearchParamValue> | undefined,
): TaskFilters {
  const first = (key: string): string => {
    const value = searchParams?.[key];
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
  };

  return taskFiltersSchema.parse({
    view: first("view"),
    assignee: first("assignee"),
    priority: first("priority"),
  });
}

/** Builds the querystring for a filter link without losing sibling filters. */
export function taskFiltersToQuery(filters: TaskFilters): string {
  const params = new URLSearchParams();
  params.set("view", filters.view);
  if (filters.assignee !== ALL_VALUE) params.set("assignee", filters.assignee);
  if (filters.priority !== ALL_VALUE) params.set("priority", filters.priority);
  return params.toString();
}
