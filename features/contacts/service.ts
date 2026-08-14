import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ImportCandidate } from "@/lib/contacts/csv";
import { normalizeEmail, normalizePhone } from "@/lib/contacts/normalize";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import type { Database } from "@/lib/supabase/database.types";
import type {
  ContactFieldsInput,
  ContactStatus,
  TagColor,
} from "@/lib/validation/contacts";

type Client = SupabaseClient<Database>;

/** Postgres unique violation. The partial indexes on contacts raise this. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

export type NormalizedContact = {
  full_name: string;
  phone_normalized: string | null;
  phone_display: string | null;
  email: string | null;
  city: string | null;
  lead_source: string | null;
  status: ContactStatus;
  assigned_to: string | null;
  next_follow_up_at: string | null;
};

/**
 * Turns validated form input into the exact column shape the table expects.
 * The phone is normalised here so the duplicate check, the unique index and the
 * WhatsApp link all agree on one canonical value.
 */
export function normalizeContactInput(
  input: ContactFieldsInput,
  country: string,
): Result<NormalizedContact> {
  let phoneNormalized: string | null = null;
  let phoneDisplay: string | null = null;

  if (input.phone) {
    const phone = normalizePhone(input.phone, country);
    if (!phone) {
      return err("validation", "Please check the highlighted fields.", {
        phone: ["That does not look like a phone number we can dial."],
      });
    }
    phoneNormalized = phone.normalized;
    phoneDisplay = phone.display;
  }

  return ok({
    full_name: input.fullName,
    phone_normalized: phoneNormalized,
    phone_display: phoneDisplay,
    email: normalizeEmail(input.email),
    city: input.city ?? null,
    lead_source: input.leadSource ?? null,
    status: input.status ?? "active",
    assigned_to: input.assignedTo ?? null,
    next_follow_up_at: input.nextFollowUpAt
      ? new Date(input.nextFollowUpAt).toISOString()
      : null,
  });
}

export type DuplicateMatch = {
  contactId: string;
  fullName: string;
  field: "phone" | "email";
};

/**
 * Looks for an existing contact in this workspace with the same normalised
 * phone or email. Run before every insert so the user gets a link to the
 * existing record instead of a database error.
 */
export async function findDuplicateContact(
  supabase: Client,
  workspaceId: string,
  candidate: {
    phoneNormalized: string | null;
    email: string | null;
    excludeContactId?: string;
  },
): Promise<DuplicateMatch | null> {
  const emailNormalized = normalizeEmail(candidate.email);

  if (candidate.phoneNormalized) {
    let query = supabase
      .from("contacts")
      .select("id, full_name")
      .eq("workspace_id", workspaceId)
      .eq("phone_normalized", candidate.phoneNormalized)
      .limit(1);
    if (candidate.excludeContactId) {
      query = query.neq("id", candidate.excludeContactId);
    }
    const { data } = await query;
    const match = data?.[0];
    if (match) {
      return { contactId: match.id, fullName: match.full_name, field: "phone" };
    }
  }

  if (emailNormalized) {
    let query = supabase
      .from("contacts")
      .select("id, full_name")
      .eq("workspace_id", workspaceId)
      .eq("email_normalized", emailNormalized)
      .limit(1);
    if (candidate.excludeContactId) {
      query = query.neq("id", candidate.excludeContactId);
    }
    const { data } = await query;
    const match = data?.[0];
    if (match) {
      return { contactId: match.id, fullName: match.full_name, field: "email" };
    }
  }

  return null;
}

export function duplicateMessage(match: DuplicateMatch): string {
  return match.field === "phone"
    ? `${match.fullName} already has this phone number.`
    : `${match.fullName} already has this email address.`;
}

/** A member may only be assigned work inside their own workspace. */
async function assertAssignee(
  supabase: Client,
  workspaceId: string,
  assignedTo: string | null,
): Promise<Result<null>> {
  if (!assignedTo) return ok(null);

  const { data } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", assignedTo)
    .limit(1);

  if (!data?.length) {
    return err("validation", "Please check the highlighted fields.", {
      assignedTo: ["That person is not in this workspace."],
    });
  }
  return ok(null);
}

export async function createContact(
  supabase: Client,
  workspaceId: string,
  actorId: string,
  values: NormalizedContact,
): Promise<Result<{ contactId: string }>> {
  const assignee = await assertAssignee(
    supabase,
    workspaceId,
    values.assigned_to,
  );
  if (!assignee.ok) return assignee;

  const { data, error } = await supabase
    .from("contacts")
    .insert({ ...values, workspace_id: workspaceId, created_by: actorId })
    .select("id")
    .single();

  if (error || !data) {
    if (isUniqueViolation(error)) {
      return err("conflict", "This contact already exists in your list.");
    }
    logger.error("contact_insert_failed", { code: error?.code });
    return err("unknown", "We could not save this contact. Please try again.");
  }

  return ok({ contactId: data.id });
}

export async function updateContact(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  values: NormalizedContact,
): Promise<Result<{ contactId: string }>> {
  const assignee = await assertAssignee(
    supabase,
    workspaceId,
    values.assigned_to,
  );
  if (!assignee.ok) return assignee;

  const { data, error } = await supabase
    .from("contacts")
    .update(values)
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return err("conflict", "Another contact already uses those details.");
    }
    logger.error("contact_update_failed", { code: error.code });
    return err("unknown", "We could not save this contact. Please try again.");
  }

  if (!data) return err("not_found", "That contact no longer exists.");
  return ok({ contactId: data.id });
}

export async function setContactStatus(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  status: ContactStatus,
): Promise<Result<{ contactId: string }>> {
  const { data, error } = await supabase
    .from("contacts")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("contact_status_update_failed", { code: error.code });
    return err("unknown", "We could not update this contact.");
  }
  if (!data) return err("not_found", "That contact no longer exists.");
  return ok({ contactId: data.id });
}

export async function addNote(
  supabase: Client,
  workspaceId: string,
  actorId: string,
  contactId: string,
  body: string,
): Promise<Result<{ noteId: string }>> {
  const owns = await contactBelongsToWorkspace(
    supabase,
    workspaceId,
    contactId,
  );
  if (!owns.ok) return owns;

  const { data, error } = await supabase
    .from("notes")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      body,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("note_insert_failed", { code: error?.code });
    return err("unknown", "We could not save that note.");
  }

  // The note doubles as the most recent contact touchpoint.
  await supabase
    .from("contacts")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", contactId);

  return ok({ noteId: data.id });
}

async function contactBelongsToWorkspace(
  supabase: Client,
  workspaceId: string,
  contactId: string,
): Promise<Result<null>> {
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .limit(1);

  if (!data?.length) return err("not_found", "That contact no longer exists.");
  return ok(null);
}

export async function createTag(
  supabase: Client,
  workspaceId: string,
  name: string,
  color: TagColor,
): Promise<Result<{ tagId: string }>> {
  const { data, error } = await supabase
    .from("tags")
    .insert({ workspace_id: workspaceId, name, color })
    .select("id")
    .single();

  if (error || !data) {
    if (isUniqueViolation(error)) {
      // Reuse the existing tag rather than telling the user off for a repeat.
      const existing = await findTagByName(supabase, workspaceId, name);
      if (existing) return ok({ tagId: existing });
      return err("conflict", "A tag with that name already exists.");
    }
    logger.error("tag_insert_failed", { code: error?.code });
    return err("unknown", "We could not create that tag.");
  }

  return ok({ tagId: data.id });
}

async function findTagByName(
  supabase: Client,
  workspaceId: string,
  name: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("tags")
    .select("id, name")
    .eq("workspace_id", workspaceId);

  const target = name.trim().toLowerCase();
  return (
    data?.find((tag) => tag.name.trim().toLowerCase() === target)?.id ?? null
  );
}

export async function attachTag(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  tagId: string,
): Promise<Result<null>> {
  const owns = await contactBelongsToWorkspace(
    supabase,
    workspaceId,
    contactId,
  );
  if (!owns.ok) return owns;

  const { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", tagId)
    .limit(1);
  if (!tag?.length) return err("not_found", "That tag no longer exists.");

  const { error } = await supabase.from("contact_tags").insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    tag_id: tagId,
  });

  if (error && !isUniqueViolation(error)) {
    logger.error("contact_tag_insert_failed", { code: error.code });
    return err("unknown", "We could not add that tag.");
  }

  return ok(null);
}

export async function detachTag(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  tagId: string,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("contact_tags")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("tag_id", tagId);

  if (error) {
    logger.error("contact_tag_delete_failed", { code: error.code });
    return err("unknown", "We could not remove that tag.");
  }
  return ok(null);
}

export async function addChannel(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  kind: Database["public"]["Enums"]["channel_kind"],
  handle: string,
  isPrimary: boolean,
): Promise<Result<{ channelId: string }>> {
  const owns = await contactBelongsToWorkspace(
    supabase,
    workspaceId,
    contactId,
  );
  if (!owns.ok) return owns;

  // A phone or WhatsApp handle is stored in its canonical form so the deep
  // link and the contact's own number agree.
  const stored =
    kind === "whatsapp" || kind === "phone"
      ? (normalizePhone(handle)?.normalized ?? null)
      : handle.trim();

  if (!stored) {
    return err("validation", "Please check the highlighted fields.", {
      handle: ["That does not look like a phone number we can dial."],
    });
  }

  const { data, error } = await supabase
    .from("contact_channels")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      kind,
      handle: stored,
      is_primary: false,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (isUniqueViolation(error)) {
      return err("conflict", "That channel is already saved for this contact.");
    }
    logger.error("contact_channel_insert_failed", { code: error?.code });
    return err("unknown", "We could not add that channel.");
  }

  if (isPrimary) {
    const promoted = await setPrimaryChannel(
      supabase,
      workspaceId,
      contactId,
      data.id,
    );
    if (!promoted.ok) return promoted;
  }

  return ok({ channelId: data.id });
}

/** Exactly one primary channel per contact: demote everything, promote one. */
export async function setPrimaryChannel(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  channelId: string,
): Promise<Result<{ channelId: string }>> {
  const { error: clearError } = await supabase
    .from("contact_channels")
    .update({ is_primary: false })
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId);

  if (clearError) {
    logger.error("contact_channel_demote_failed", { code: clearError.code });
    return err("unknown", "We could not update that channel.");
  }

  const { data, error } = await supabase
    .from("contact_channels")
    .update({ is_primary: true })
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("id", channelId)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error("contact_channel_promote_failed", { code: error.code });
    return err("unknown", "We could not update that channel.");
  }
  if (!data) return err("not_found", "That channel no longer exists.");
  return ok({ channelId: data.id });
}

export async function removeChannel(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  channelId: string,
): Promise<Result<null>> {
  const { error } = await supabase
    .from("contact_channels")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("id", channelId);

  if (error) {
    logger.error("contact_channel_delete_failed", { code: error.code });
    return err("unknown", "We could not remove that channel.");
  }
  return ok(null);
}

/**
 * Creates any tags that do not exist yet and returns a lowercase-name -> id
 * map covering every requested name.
 */
export async function ensureTags(
  supabase: Client,
  workspaceId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (key !== "" && !wanted.has(key)) wanted.set(key, name.trim());
  }
  if (wanted.size === 0) return new Map();

  const { data: existing } = await supabase
    .from("tags")
    .select("id, name")
    .eq("workspace_id", workspaceId);

  const byName = new Map<string, string>();
  for (const tag of existing ?? []) {
    byName.set(tag.name.trim().toLowerCase(), tag.id);
  }

  const missing = [...wanted.entries()].filter(([key]) => !byName.has(key));
  if (missing.length === 0) return byName;

  const { data: inserted } = await supabase
    .from("tags")
    .insert(missing.map(([, name]) => ({ workspace_id: workspaceId, name })))
    .select("id, name");

  for (const tag of inserted ?? []) {
    byName.set(tag.name.trim().toLowerCase(), tag.id);
  }

  return byName;
}

export type ImportOutcome = {
  inserted: number;
  skipped: { line: number; label: string; reason: string }[];
};

/**
 * Inserts the rows the preview classified as valid.
 *
 * The batch insert is attempted first; if the database rejects it on a unique
 * index - someone else added the same number between preview and confirm - the
 * batch is retried row by row so one clash cannot lose the other 99 rows.
 */
export async function importContacts(
  supabase: Client,
  workspaceId: string,
  actorId: string,
  candidates: readonly ImportCandidate[],
): Promise<Result<ImportOutcome>> {
  const skipped: ImportOutcome["skipped"] = [];
  const insertedRows: {
    id: string;
    phone_normalized: string | null;
    email_normalized: string | null;
    full_name: string;
  }[] = [];

  const toRow = (candidate: ImportCandidate) => ({
    workspace_id: workspaceId,
    created_by: actorId,
    full_name: candidate.fullName,
    phone_normalized: candidate.phoneNormalized,
    phone_display: candidate.phoneDisplay,
    email: candidate.email,
    city: candidate.city,
    lead_source: candidate.leadSource,
    status: candidate.status,
    next_follow_up_at: candidate.nextFollowUpAt,
  });

  const CHUNK = 100;
  for (let start = 0; start < candidates.length; start += CHUNK) {
    const chunk = candidates.slice(start, start + CHUNK);

    const { data, error } = await supabase
      .from("contacts")
      .insert(chunk.map(toRow))
      .select("id, full_name, phone_normalized, email_normalized");

    if (!error && data) {
      insertedRows.push(...data);
      continue;
    }

    if (!isUniqueViolation(error)) {
      logger.error("contact_import_insert_failed", { code: error?.code });
      return err("unknown", "We could not finish the import. Nothing changed.");
    }

    for (const candidate of chunk) {
      const single = await supabase
        .from("contacts")
        .insert(toRow(candidate))
        .select("id, full_name, phone_normalized, email_normalized")
        .single();

      if (single.error || !single.data) {
        skipped.push({
          line: candidate.line,
          label: candidate.fullName,
          reason: isUniqueViolation(single.error)
            ? "Someone with the same phone or email was added while you were reviewing."
            : "We could not save this row.",
        });
        continue;
      }
      insertedRows.push(single.data);
    }
  }

  const tagNames = candidates.flatMap((candidate) => candidate.tags);
  if (tagNames.length > 0 && insertedRows.length > 0) {
    const tagIds = await ensureTags(supabase, workspaceId, tagNames);

    const byPhone = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const row of insertedRows) {
      if (row.phone_normalized) byPhone.set(row.phone_normalized, row.id);
      if (row.email_normalized) byEmail.set(row.email_normalized, row.id);
    }

    const links: {
      workspace_id: string;
      contact_id: string;
      tag_id: string;
    }[] = [];

    for (const candidate of candidates) {
      if (candidate.tags.length === 0) continue;
      const contactId =
        (candidate.phoneNormalized
          ? byPhone.get(candidate.phoneNormalized)
          : undefined) ??
        (candidate.email ? byEmail.get(candidate.email) : undefined);
      if (!contactId) continue;

      for (const tag of candidate.tags) {
        const tagId = tagIds.get(tag.trim().toLowerCase());
        if (tagId) {
          links.push({
            workspace_id: workspaceId,
            contact_id: contactId,
            tag_id: tagId,
          });
        }
      }
    }

    if (links.length > 0) {
      const { error: linkError } = await supabase
        .from("contact_tags")
        .insert(links);
      // Tags are a convenience: the contacts themselves are already saved.
      if (linkError && !isUniqueViolation(linkError)) {
        logger.warn("contact_import_tag_link_failed", {
          code: linkError.code,
        });
      }
    }
  }

  return ok({ inserted: insertedRows.length, skipped });
}
