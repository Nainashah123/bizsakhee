import "server-only";

import { err, ok, type Result } from "@/lib/result";
import { logger } from "@/lib/logger";
import { ROLE_LABELS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type {
  TaskPriority,
  TaskStatusEnum,
  WorkspaceRoleEnum,
} from "@/lib/supabase/database.types";
import {
  classifyDueAt,
  TASK_VIEWS,
  taskViewWindow,
  type TaskDueBucket,
  type TaskView,
} from "@/lib/tasks/filters";
import {
  ALL_VALUE,
  formatRelatedRef,
  RELATED_KIND_LABELS,
  type RelatedKind,
  type TaskFilters,
} from "@/lib/validation/tasks";

/**
 * Read paths for follow-ups.
 *
 * Every query is scoped with `.eq("workspace_id", …)` on top of RLS, and no
 * query uses a PostgREST embedded select - related records are fetched by id
 * and joined in TypeScript.
 */

const PAGE_SIZE = 100;
const OPTION_LIMIT = 100;

export type TaskRelatedSummary = {
  kind: RelatedKind;
  id: string;
  label: string;
  value: string;
};

export type TaskListItem = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusEnum;
  priority: TaskPriority;
  dueAt: string | null;
  assignedTo: string | null;
  completedAt: string | null;
  bucket: TaskDueBucket;
  related: TaskRelatedSummary | null;
};

export type WorkspaceMemberOption = {
  userId: string;
  label: string;
  role: WorkspaceRoleEnum;
  isSelf: boolean;
};

export type TaskRelatedOption = {
  value: string;
  label: string;
  kind: RelatedKind;
};

export type TaskPage = {
  tasks: TaskListItem[];
  /** True when more rows exist than this page shows. */
  hasMore: boolean;
};

const GENERIC_READ_ERROR =
  "We could not load your follow-ups. Please refresh and try again.";

/**
 * People who can own a follow-up.
 *
 * `profiles` is readable only by its owner (see the RLS policies), so a
 * teammate's name is not available to this session. Rather than invent one, a
 * teammate is labelled by role plus a short id - honest, stable and unique.
 */
export async function getWorkspaceMemberOptions(
  workspaceId: string,
  currentUserId: string,
): Promise<Result<WorkspaceMemberOption[]>> {
  const supabase = await createClient();

  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("tasks_members_query_failed", { code: error.code });
    return err("unknown", GENERIC_READ_ERROR);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", currentUserId)
    .maybeSingle();

  const options = (members ?? []).map((member) => {
    const isSelf = member.user_id === currentUserId;
    const own = profile?.full_name?.trim();
    return {
      userId: member.user_id,
      role: member.role,
      isSelf,
      label: isSelf
        ? own
          ? `${own} (you)`
          : "You"
        : `${ROLE_LABELS[member.role] ?? "Teammate"} · ${member.user_id.slice(0, 8)}`,
    } satisfies WorkspaceMemberOption;
  });

  return ok(options);
}

/** Records a follow-up can be attached to, for the "Related to" select. */
export async function getTaskRelatedOptions(
  workspaceId: string,
): Promise<Result<TaskRelatedOption[]>> {
  const supabase = await createClient();

  const [contacts, orders, opportunities] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("full_name", { ascending: true })
      .limit(OPTION_LIMIT),
    supabase
      .from("orders")
      .select("id, order_number")
      .eq("workspace_id", workspaceId)
      .order("order_number", { ascending: false })
      .limit(OPTION_LIMIT),
    supabase
      .from("opportunities")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(OPTION_LIMIT),
  ]);

  const failure = contacts.error ?? orders.error ?? opportunities.error;
  if (failure) {
    logger.error("tasks_related_options_query_failed", { code: failure.code });
    return err("unknown", GENERIC_READ_ERROR);
  }

  const options: TaskRelatedOption[] = [
    ...(contacts.data ?? []).map((row) => ({
      value: formatRelatedRef("contact", row.id),
      label: row.full_name,
      kind: "contact" as const,
    })),
    ...(orders.data ?? []).map((row) => ({
      value: formatRelatedRef("order", row.id),
      label: `Order #${row.order_number}`,
      kind: "order" as const,
    })),
    ...(opportunities.data ?? []).map((row) => ({
      value: formatRelatedRef("opportunity", row.id),
      label: row.title,
      kind: "opportunity" as const,
    })),
  ];

  return ok(options);
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusEnum;
  priority: TaskPriority;
  due_at: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  contact_id: string | null;
  order_id: string | null;
  opportunity_id: string | null;
};

const TASK_COLUMNS =
  "id, title, description, status, priority, due_at, assigned_to, completed_at, contact_id, order_id, opportunity_id";

/**
 * Resolves the display label for whatever each task is attached to.
 *
 * Three small `in (…)` lookups instead of a PostgREST embedded select, which is
 * banned here because the hand-written database types carry no relationship
 * metadata for the client to resolve.
 */
async function resolveRelated(
  workspaceId: string,
  rows: TaskRow[],
): Promise<Map<string, TaskRelatedSummary>> {
  const contactIds = [
    ...new Set(rows.flatMap((row) => (row.contact_id ? [row.contact_id] : []))),
  ];
  const orderIds = [
    ...new Set(rows.flatMap((row) => (row.order_id ? [row.order_id] : []))),
  ];
  const opportunityIds = [
    ...new Set(
      rows.flatMap((row) => (row.opportunity_id ? [row.opportunity_id] : [])),
    ),
  ];

  const summaries = new Map<string, TaskRelatedSummary>();
  if (!contactIds.length && !orderIds.length && !opportunityIds.length) {
    return summaries;
  }

  const supabase = await createClient();

  const [contacts, orders, opportunities] = await Promise.all([
    contactIds.length
      ? supabase
          .from("contacts")
          .select("id, full_name")
          .eq("workspace_id", workspaceId)
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? supabase
          .from("orders")
          .select("id, order_number")
          .eq("workspace_id", workspaceId)
          .in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    opportunityIds.length
      ? supabase
          .from("opportunities")
          .select("id, title")
          .eq("workspace_id", workspaceId)
          .in("id", opportunityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const row of contacts.data ?? []) {
    summaries.set(`contact:${row.id}`, {
      kind: "contact",
      id: row.id,
      label: row.full_name,
      value: formatRelatedRef("contact", row.id),
    });
  }
  for (const row of orders.data ?? []) {
    summaries.set(`order:${row.id}`, {
      kind: "order",
      id: row.id,
      label: `Order #${row.order_number}`,
      value: formatRelatedRef("order", row.id),
    });
  }
  for (const row of opportunities.data ?? []) {
    summaries.set(`opportunity:${row.id}`, {
      kind: "opportunity",
      id: row.id,
      label: row.title,
      value: formatRelatedRef("opportunity", row.id),
    });
  }

  return summaries;
}

function relatedKeyFor(row: TaskRow): string | null {
  if (row.contact_id) return `contact:${row.contact_id}`;
  if (row.order_id) return `order:${row.order_id}`;
  if (row.opportunity_id) return `opportunity:${row.opportunity_id}`;
  return null;
}

/** The rows for one tab, already filtered, sorted and classified. */
export async function getTasksForView(
  workspaceId: string,
  filters: TaskFilters,
  now: Date,
  timeZone: string,
): Promise<Result<TaskPage>> {
  const supabase = await createClient();
  const window = taskViewWindow(filters.view, now, timeZone);

  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", window.status);

  if (window.dueIsNull) query = query.is("due_at", null);
  if (window.dueGte) query = query.gte("due_at", window.dueGte);
  if (window.dueLt) query = query.lt("due_at", window.dueLt);
  if (filters.assignee !== ALL_VALUE) {
    query = query.eq("assigned_to", filters.assignee);
  }
  if (filters.priority !== ALL_VALUE) {
    query = query.eq("priority", filters.priority);
  }

  if (filters.view === "completed") {
    query = query.order("completed_at", { ascending: false });
  } else if (filters.view === "no_date") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.order("due_at", { ascending: true });
  }

  // One extra row is the cheapest way to know whether a "load more" hint is
  // honest without paying for a second count query.
  const { data, error } = await query.limit(PAGE_SIZE + 1);

  if (error) {
    logger.error("tasks_list_query_failed", {
      code: error.code,
      view: filters.view,
    });
    return err("unknown", GENERIC_READ_ERROR);
  }

  const rows = (data ?? []) as TaskRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const related = await resolveRelated(workspaceId, page);

  const tasks: TaskListItem[] = page.map((row) => {
    const key = relatedKeyFor(row);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueAt: row.due_at,
      assignedTo: row.assigned_to,
      completedAt: row.completed_at,
      bucket: classifyDueAt(row.due_at, now, timeZone),
      related: (key ? related.get(key) : null) ?? null,
    };
  });

  return ok({ tasks, hasMore });
}

/**
 * Counts for the tab badges. The assignee and priority filters are applied so a
 * badge always describes what clicking the tab will actually show.
 */
export async function getTaskViewCounts(
  workspaceId: string,
  filters: TaskFilters,
  now: Date,
  timeZone: string,
): Promise<Result<Record<TaskView, number>>> {
  const supabase = await createClient();

  const results = await Promise.all(
    TASK_VIEWS.map(async (view) => {
      const window = taskViewWindow(view, now, timeZone);

      let query = supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", window.status);

      if (window.dueIsNull) query = query.is("due_at", null);
      if (window.dueGte) query = query.gte("due_at", window.dueGte);
      if (window.dueLt) query = query.lt("due_at", window.dueLt);
      if (filters.assignee !== ALL_VALUE) {
        query = query.eq("assigned_to", filters.assignee);
      }
      if (filters.priority !== ALL_VALUE) {
        query = query.eq("priority", filters.priority);
      }

      const { count, error } = await query;
      return { view, count: count ?? 0, error };
    }),
  );

  const failure = results.find((result) => result.error)?.error;
  if (failure) {
    logger.error("tasks_count_query_failed", { code: failure.code });
    return err("unknown", GENERIC_READ_ERROR);
  }

  const counts = {
    due_today: 0,
    overdue: 0,
    upcoming: 0,
    no_date: 0,
    completed: 0,
  } satisfies Record<TaskView, number>;

  for (const result of results) counts[result.view] = result.count;
  return ok(counts);
}

/** Label used in the "Related to" select group headings. */
export function relatedGroupLabel(kind: RelatedKind): string {
  return RELATED_KIND_LABELS[kind];
}
