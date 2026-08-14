import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  CONTACT_PAGE_SIZE,
  type ContactFilters,
  type ContactStatus,
} from "@/lib/validation/contacts";

type Client = SupabaseClient<Database>;

export type ContactTag = { id: string; name: string; color: string };

export type ContactListItem = {
  id: string;
  fullName: string;
  phoneNormalized: string | null;
  phoneDisplay: string | null;
  email: string | null;
  city: string | null;
  leadSource: string | null;
  status: ContactStatus;
  assignedTo: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  tags: ContactTag[];
};

export type ContactListPage = {
  contacts: ContactListItem[];
  total: number;
  page: number;
  pageCount: number;
  /** True when the database call failed, so the page can show an error state. */
  failed: boolean;
};

const CONTACT_COLUMNS =
  "id, full_name, phone_normalized, phone_display, email, city, lead_source, status, assigned_to, next_follow_up_at, last_contacted_at, created_at" as const;

type ContactColumns = {
  id: string;
  full_name: string;
  phone_normalized: string | null;
  phone_display: string | null;
  email: string | null;
  city: string | null;
  lead_source: string | null;
  status: ContactStatus;
  assigned_to: string | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  created_at: string;
};

function toListItem(row: ContactColumns, tags: ContactTag[]): ContactListItem {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneNormalized: row.phone_normalized,
    phoneDisplay: row.phone_display,
    email: row.email,
    city: row.city,
    leadSource: row.lead_source,
    status: row.status,
    assignedTo: row.assigned_to,
    nextFollowUpAt: row.next_follow_up_at,
    lastContactedAt: row.last_contacted_at,
    createdAt: row.created_at,
    tags,
  };
}

/**
 * PostgREST parses `or=(...)` as a comma separated list, so a search term
 * containing a comma, bracket or wildcard would change the filter's meaning.
 * Those characters carry no search value here, so they are simply dropped.
 */
function sanitizeSearch(term: string): string {
  return term
    .replace(/[,()"'\\%*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Contact ids carrying a tag - fetched separately, never as an embedded select. */
async function contactIdsForTag(
  supabase: Client,
  workspaceId: string,
  tagId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("contact_tags")
    .select("contact_id")
    .eq("workspace_id", workspaceId)
    .eq("tag_id", tagId)
    .limit(5000);

  return (data ?? []).map((row) => row.contact_id);
}

async function tagsByContact(
  supabase: Client,
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, ContactTag[]>> {
  const result = new Map<string, ContactTag[]>();
  if (contactIds.length === 0) return result;

  const { data: links } = await supabase
    .from("contact_tags")
    .select("contact_id, tag_id")
    .eq("workspace_id", workspaceId)
    .in("contact_id", contactIds);

  const tagIds = [...new Set((links ?? []).map((link) => link.tag_id))];
  if (tagIds.length === 0) return result;

  const { data: tags } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("workspace_id", workspaceId)
    .in("id", tagIds);

  const tagById = new Map((tags ?? []).map((tag) => [tag.id, tag]));

  for (const link of links ?? []) {
    const tag = tagById.get(link.tag_id);
    if (!tag) continue;
    const bucket = result.get(link.contact_id) ?? [];
    bucket.push({ id: tag.id, name: tag.name, color: tag.color });
    result.set(link.contact_id, bucket);
  }

  for (const bucket of result.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

/**
 * Filters and sort shared by the paginated list and the CSV export, so an
 * export always contains exactly the rows the user is looking at.
 */
function buildContactQuery(
  supabase: Client,
  workspaceId: string,
  filters: ContactFilters,
  tagContactIds: string[] | null,
  withCount: boolean,
) {
  let query = supabase
    .from("contacts")
    .select(CONTACT_COLUMNS, withCount ? { count: "exact" } : undefined)
    .eq("workspace_id", workspaceId);

  if (filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (tagContactIds) {
    query = query.in("id", tagContactIds);
  }

  const term = sanitizeSearch(filters.search);
  if (term !== "") {
    const digits = term.replace(/\D/g, "");
    const clauses = [
      `full_name.ilike.%${term}%`,
      `email.ilike.%${term}%`,
      `city.ilike.%${term}%`,
    ];
    if (digits.length >= 3) {
      clauses.push(`phone_normalized.ilike.%${digits}%`);
    }
    query = query.or(clauses.join(","));
  }

  if (filters.sort === "name") {
    return query.order("full_name", { ascending: true });
  }

  if (filters.sort === "follow_up") {
    return query
      .order("next_follow_up_at", { ascending: true, nullsFirst: false })
      .order("full_name", { ascending: true });
  }

  return query.order("created_at", { ascending: false });
}

export async function listContacts(
  workspaceId: string,
  filters: ContactFilters,
  pageSize: number = CONTACT_PAGE_SIZE,
): Promise<ContactListPage> {
  const supabase = await createClient();

  let tagContactIds: string[] | null = null;
  if (filters.tagId) {
    tagContactIds = await contactIdsForTag(
      supabase,
      workspaceId,
      filters.tagId,
    );
    if (tagContactIds.length === 0) {
      return { contacts: [], total: 0, page: 1, pageCount: 1, failed: false };
    }
  }

  const from = (filters.page - 1) * pageSize;

  const { data, count, error } = await buildContactQuery(
    supabase,
    workspaceId,
    filters,
    tagContactIds,
    true,
  ).range(from, from + pageSize - 1);

  if (error) {
    return {
      contacts: [],
      total: 0,
      page: filters.page,
      pageCount: 1,
      failed: true,
    };
  }

  const rows = (data ?? []) as unknown as ContactColumns[];
  const tagMap = await tagsByContact(
    supabase,
    workspaceId,
    rows.map((row) => row.id),
  );

  const total = count ?? rows.length;

  return {
    contacts: rows.map((row) => toListItem(row, tagMap.get(row.id) ?? [])),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    failed: false,
  };
}

/** Every matching contact, for the CSV export of the filtered list. */
export async function listContactsForExport(
  workspaceId: string,
  filters: ContactFilters,
  limit = 5000,
): Promise<ContactListItem[] | null> {
  const supabase = await createClient();

  let tagContactIds: string[] | null = null;
  if (filters.tagId) {
    tagContactIds = await contactIdsForTag(
      supabase,
      workspaceId,
      filters.tagId,
    );
    if (tagContactIds.length === 0) return [];
  }

  const { data, error } = await buildContactQuery(
    supabase,
    workspaceId,
    filters,
    tagContactIds,
    false,
  ).limit(limit);

  if (error) return null;

  const rows = (data ?? []) as unknown as ContactColumns[];
  const tagMap = await tagsByContact(
    supabase,
    workspaceId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => toListItem(row, tagMap.get(row.id) ?? []));
}

/** The phone and email keys the importer needs to spot duplicates. */
export async function listDedupeKeys(
  supabase: Client,
  workspaceId: string,
  limit = 5000,
): Promise<
  {
    id: string;
    fullName: string;
    phoneNormalized: string | null;
    emailNormalized: string | null;
  }[]
> {
  const { data } = await supabase
    .from("contacts")
    .select("id, full_name, phone_normalized, email_normalized")
    .eq("workspace_id", workspaceId)
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    phoneNormalized: row.phone_normalized,
    emailNormalized: row.email_normalized,
  }));
}

export type ContactChannel = {
  id: string;
  kind: Database["public"]["Enums"]["channel_kind"];
  handle: string;
  isPrimary: boolean;
};

export type ContactNote = {
  id: string;
  body: string;
  createdAt: string;
  createdBy: string | null;
};

export type ContactDetail = {
  contact: ContactListItem;
  channels: ContactChannel[];
  notes: ContactNote[];
};

export async function getContactDetail(
  workspaceId: string,
  contactId: string,
): Promise<ContactDetail | null> {
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error || !row) return null;
  const contactRow = row as unknown as ContactColumns;

  const [channels, notes, tagMap] = await Promise.all([
    supabase
      .from("contact_channels")
      .select("id, kind, handle, is_primary")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("notes")
      .select("id, body, created_at, created_by")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(50),
    tagsByContact(supabase, workspaceId, [contactId]),
  ]);

  return {
    contact: toListItem(contactRow, tagMap.get(contactId) ?? []),
    channels: (channels.data ?? []).map((channel) => ({
      id: channel.id,
      kind: channel.kind,
      handle: channel.handle,
      isPrimary: channel.is_primary,
    })),
    notes: (notes.data ?? []).map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.created_at,
      createdBy: note.created_by,
    })),
  };
}

export type TimelineEntryType = "note" | "task" | "order" | "message";

export type TimelineEntry = {
  id: string;
  type: TimelineEntryType;
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
};

/**
 * One merged history for a contact.
 *
 * Each table is queried on its own and merged in TypeScript - embedded selects
 * are not available with hand-written database types, and messages hang off
 * conversations rather than off the contact directly.
 */
export async function getContactTimeline(
  workspaceId: string,
  contactId: string,
  limit = 60,
): Promise<{ entries: TimelineEntry[]; failed: boolean }> {
  const supabase = await createClient();

  const [notes, tasks, orders, conversations] = await Promise.all([
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("tasks")
      .select("id, title, status, due_at, created_at, completed_at")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("orders")
      .select(
        "id, order_number, status, payment_status, total_minor, currency, created_at",
      )
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("conversations")
      .select("id, channel")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .limit(50),
  ]);

  const failed = Boolean(
    notes.error || tasks.error || orders.error || conversations.error,
  );

  const entries: TimelineEntry[] = [];

  for (const note of notes.data ?? []) {
    entries.push({
      id: `note-${note.id}`,
      type: "note",
      at: note.created_at,
      title: "Note added",
      detail: note.body,
      href: null,
    });
  }

  for (const task of tasks.data ?? []) {
    entries.push({
      id: `task-${task.id}`,
      type: "task",
      at: task.completed_at ?? task.created_at,
      title: task.title,
      detail:
        task.status === "completed"
          ? "Follow-up completed"
          : task.due_at
            ? `Follow-up due ${new Date(task.due_at).toLocaleDateString("en-IN")}`
            : "Follow-up open",
      href: null,
    });
  }

  for (const order of orders.data ?? []) {
    entries.push({
      id: `order-${order.id}`,
      type: "order",
      at: order.created_at,
      title: `Order #${order.order_number}`,
      detail: `${order.status} - ${order.payment_status.replace("_", " ")}`,
      href: null,
    });
  }

  const conversationIds = (conversations.data ?? []).map((row) => row.id);
  const channelById = new Map(
    (conversations.data ?? []).map((row) => [row.id, row.channel]),
  );

  if (conversationIds.length > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("id, conversation_id, direction, body, sent_at")
      .eq("workspace_id", workspaceId)
      .in("conversation_id", conversationIds)
      .order("sent_at", { ascending: false })
      .limit(limit);

    for (const message of messages ?? []) {
      const channel = channelById.get(message.conversation_id) ?? "manual";
      entries.push({
        id: `message-${message.id}`,
        type: "message",
        at: message.sent_at,
        title:
          message.direction === "inbound"
            ? `Message received on ${channel}`
            : `Message sent on ${channel}`,
        detail: message.body,
        href: null,
      });
    }
  }

  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return { entries: entries.slice(0, limit), failed };
}

export async function listTags(
  workspaceId: string,
): Promise<{ id: string; name: string; color: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  return data ?? [];
}

export type WorkspacePerson = { userId: string; name: string };

/**
 * Teammates who can own a contact. Membership and profile live in different
 * tables, so both are read and joined here rather than with an embed.
 */
export async function listWorkspacePeople(
  workspaceId: string,
): Promise<WorkspacePerson[]> {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  const userIds = (members ?? []).map((member) => member.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);

  const nameById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name]),
  );

  return userIds.map((userId) => ({
    userId,
    name: nameById.get(userId) || "Teammate",
  }));
}
