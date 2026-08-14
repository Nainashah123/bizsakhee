"use server";

import { revalidatePath } from "next/cache";

import { requireCapability, resolveWorkspace } from "@/lib/auth/session";
import {
  classifyImportRows,
  contactsToCsv,
  mapHeaders,
  parseCsv,
  type DuplicateImportRow,
  type ImportCandidate,
  type InvalidImportRow,
} from "@/lib/contacts/csv";
import { normalizeEmail, normalizePhone } from "@/lib/contacts/normalize";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import {
  channelCreateSchema,
  channelDeleteSchema,
  channelPrimarySchema,
  contactArchiveSchema,
  contactCreateSchema,
  contactExportSchema,
  contactTagSchema,
  contactUpdateSchema,
  csvImportSchema,
  noteCreateSchema,
  tagCreateSchema,
  type ContactFilters,
} from "@/lib/validation/contacts";
import {
  listContactsForExport,
  listDedupeKeys,
} from "@/features/contacts/queries";
import {
  addChannel,
  addNote,
  attachTag,
  createContact,
  createTag,
  detachTag,
  duplicateMessage,
  findDuplicateContact,
  importContacts,
  normalizeContactInput,
  removeChannel,
  setContactStatus,
  setPrimaryChannel,
  updateContact,
} from "@/features/contacts/service";

const LIST_PATH = "/dashboard/contacts";

export type ContactActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  /** Set when the write was refused because the contact already exists. */
  conflict?: { contactId: string; fullName: string };
  /** Set on a successful create, so the dialog can close and link onwards. */
  contactId?: string;
};

function revalidateContact(contactId?: string) {
  revalidatePath(LIST_PATH);
  if (contactId) revalidatePath(`${LIST_PATH}/${contactId}`);
}

export async function createContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(contactCreateSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace, user } = authorized.data;
  const normalized = normalizeContactInput(parsed.data, workspace.country);
  if (!normalized.ok) {
    return {
      error: normalized.error.message,
      fieldErrors: normalized.error.fieldErrors,
    };
  }

  const supabase = await createClient();

  // Checked before the insert so the user gets a name and a link rather than a
  // unique-index error; the index below is still the final authority.
  const existing = await findDuplicateContact(supabase, workspace.id, {
    phoneNormalized: normalized.data.phone_normalized,
    email: normalized.data.email,
  });

  if (existing) {
    return {
      error: duplicateMessage(existing),
      conflict: {
        contactId: existing.contactId,
        fullName: existing.fullName,
      },
    };
  }

  const created = await createContact(
    supabase,
    workspace.id,
    user.id,
    normalized.data,
  );

  if (!created.ok) {
    if (created.error.code === "conflict") {
      const raced = await findDuplicateContact(supabase, workspace.id, {
        phoneNormalized: normalized.data.phone_normalized,
        email: normalized.data.email,
      });
      return {
        error: raced ? duplicateMessage(raced) : created.error.message,
        conflict: raced
          ? { contactId: raced.contactId, fullName: raced.fullName }
          : undefined,
      };
    }
    return {
      error: created.error.message,
      fieldErrors: created.error.fieldErrors,
    };
  }

  revalidateContact(created.data.contactId);
  return {
    message: `${normalized.data.full_name} is saved.`,
    contactId: created.data.contactId,
  };
}

export async function updateContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(contactUpdateSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace } = authorized.data;
  const { contactId, ...fields } = parsed.data;
  const normalized = normalizeContactInput(fields, workspace.country);
  if (!normalized.ok) {
    return {
      error: normalized.error.message,
      fieldErrors: normalized.error.fieldErrors,
    };
  }

  const supabase = await createClient();

  const existing = await findDuplicateContact(supabase, workspace.id, {
    phoneNormalized: normalized.data.phone_normalized,
    email: normalized.data.email,
    excludeContactId: contactId,
  });

  if (existing) {
    return {
      error: duplicateMessage(existing),
      conflict: { contactId: existing.contactId, fullName: existing.fullName },
    };
  }

  const saved = await updateContact(
    supabase,
    workspace.id,
    contactId,
    normalized.data,
  );

  if (!saved.ok) {
    if (saved.error.code === "conflict") {
      const raced = await findDuplicateContact(supabase, workspace.id, {
        phoneNormalized: normalized.data.phone_normalized,
        email: normalized.data.email,
        excludeContactId: contactId,
      });
      return {
        error: raced ? duplicateMessage(raced) : saved.error.message,
        conflict: raced
          ? { contactId: raced.contactId, fullName: raced.fullName }
          : undefined,
      };
    }
    return { error: saved.error.message, fieldErrors: saved.error.fieldErrors };
  }

  revalidateContact(contactId);
  return { message: "Saved.", contactId };
}

export async function setContactStatusAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(contactArchiveSchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const supabase = await createClient();
  const result = await setContactStatus(
    supabase,
    authorized.data.workspace.id,
    parsed.data.contactId,
    parsed.data.status,
  );

  if (!result.ok) return { error: result.error.message };

  revalidateContact(parsed.data.contactId);
  return {
    message:
      parsed.data.status === "archived"
        ? "Contact archived."
        : "Contact restored.",
    contactId: parsed.data.contactId,
  };
}

export async function addNoteAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(noteCreateSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();
  const result = await addNote(
    supabase,
    authorized.data.workspace.id,
    authorized.data.user.id,
    parsed.data.contactId,
    parsed.data.body,
  );

  if (!result.ok) return { error: result.error.message };

  revalidateContact(parsed.data.contactId);
  return { message: "Note added.", contactId: parsed.data.contactId };
}

export async function createTagAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(tagCreateSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();
  const workspaceId = authorized.data.workspace.id;

  const tag = await createTag(
    supabase,
    workspaceId,
    parsed.data.name,
    parsed.data.color ?? "plum",
  );
  if (!tag.ok) return { error: tag.error.message };

  if (parsed.data.contactId) {
    const attached = await attachTag(
      supabase,
      workspaceId,
      parsed.data.contactId,
      tag.data.tagId,
    );
    if (!attached.ok) return { error: attached.error.message };
  }

  revalidateContact(parsed.data.contactId);
  return { message: `Tag "${parsed.data.name}" is ready.` };
}

export async function attachTagAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(contactTagSchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const supabase = await createClient();
  const result = await attachTag(
    supabase,
    authorized.data.workspace.id,
    parsed.data.contactId,
    parsed.data.tagId,
  );
  if (!result.ok) return { error: result.error.message };

  revalidateContact(parsed.data.contactId);
  return { message: "Tag added.", contactId: parsed.data.contactId };
}

export async function detachTagAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(contactTagSchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const supabase = await createClient();
  const result = await detachTag(
    supabase,
    authorized.data.workspace.id,
    parsed.data.contactId,
    parsed.data.tagId,
  );
  if (!result.ok) return { error: result.error.message };

  revalidateContact(parsed.data.contactId);
  return { message: "Tag removed.", contactId: parsed.data.contactId };
}

export async function addChannelAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(channelCreateSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();
  const result = await addChannel(
    supabase,
    authorized.data.workspace.id,
    parsed.data.contactId,
    parsed.data.kind,
    parsed.data.handle,
    parsed.data.isPrimary,
  );

  if (!result.ok) {
    return {
      error: result.error.message,
      fieldErrors: result.error.fieldErrors,
    };
  }

  revalidateContact(parsed.data.contactId);
  return { message: "Channel added.", contactId: parsed.data.contactId };
}

export async function setPrimaryChannelAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(channelPrimarySchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const supabase = await createClient();
  const result = await setPrimaryChannel(
    supabase,
    authorized.data.workspace.id,
    parsed.data.contactId,
    parsed.data.channelId,
  );
  if (!result.ok) return { error: result.error.message };

  revalidateContact(parsed.data.contactId);
  return {
    message: "Primary channel updated.",
    contactId: parsed.data.contactId,
  };
}

export async function removeChannelAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(channelDeleteSchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const supabase = await createClient();
  const result = await removeChannel(
    supabase,
    authorized.data.workspace.id,
    parsed.data.contactId,
    parsed.data.channelId,
  );
  if (!result.ok) return { error: result.error.message };

  revalidateContact(parsed.data.contactId);
  return { message: "Channel removed.", contactId: parsed.data.contactId };
}

export type ImportPreviewRow = {
  line: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  leadSource: string | null;
  tags: string[];
};

export type ImportState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  preview?: {
    /** Echoed back so the confirm step imports exactly what was reviewed. */
    csv: string;
    valid: ImportPreviewRow[];
    invalid: InvalidImportRow[];
    duplicates: DuplicateImportRow[];
  };
  imported?: {
    inserted: number;
    skipped: { line: number; label: string; reason: string }[];
  };
};

async function classifyCsv(
  csv: string,
  workspaceId: string,
  country: string,
): Promise<
  | {
      ok: true;
      valid: ImportCandidate[];
      invalid: InvalidImportRow[];
      duplicates: DuplicateImportRow[];
    }
  | { ok: false; message: string }
> {
  const document = parseCsv(csv);

  if (document.headers.length === 0) {
    return { ok: false, message: "That file looks empty." };
  }
  if (mapHeaders(document.headers).fullName === undefined) {
    return {
      ok: false,
      message:
        "We could not find a name column. Add a column headed Name and try again.",
    };
  }
  if (document.records.length === 0) {
    return {
      ok: false,
      message: "That file has a header row but no contacts underneath it.",
    };
  }

  const supabase = await createClient();
  const existing = await listDedupeKeys(supabase, workspaceId);

  const classified = classifyImportRows(document, {
    existing,
    defaultCountry: country,
  });

  return { ok: true, ...classified };
}

export async function previewContactImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(csvImportSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace } = authorized.data;
  const classified = await classifyCsv(
    parsed.data.csv,
    workspace.id,
    workspace.country,
  );
  if (!classified.ok) return { error: classified.message };

  return {
    preview: {
      csv: parsed.data.csv,
      valid: classified.valid.map((row) => ({
        line: row.line,
        fullName: row.fullName,
        phone: row.phoneDisplay,
        email: row.email,
        city: row.city,
        leadSource: row.leadSource,
        tags: row.tags,
      })),
      invalid: classified.invalid,
      duplicates: classified.duplicates,
    },
  };
}

export async function confirmContactImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const authorized = await requireCapability("contacts.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(csvImportSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace, user } = authorized.data;

  // Re-classified rather than trusting a preview payload from the browser: the
  // rows that get inserted are the ones the server just validated.
  const classified = await classifyCsv(
    parsed.data.csv,
    workspace.id,
    workspace.country,
  );
  if (!classified.ok) return { error: classified.message };

  if (classified.valid.length === 0) {
    return {
      error:
        "There is nothing left to import - every row was either invalid or already saved.",
    };
  }

  const supabase = await createClient();
  const result = await importContacts(
    supabase,
    workspace.id,
    user.id,
    classified.valid,
  );

  if (!result.ok) return { error: result.error.message };

  revalidatePath(LIST_PATH);

  const { inserted, skipped } = result.data;
  return {
    message: `Imported ${inserted} contact${inserted === 1 ? "" : "s"}.`,
    imported: { inserted, skipped },
  };
}

export type ExportResult =
  { ok: true; filename: string; csv: string } | { ok: false; error: string };

/**
 * Builds the CSV for the current filters. It returns the text rather than a
 * file response so the browser can save it without a public download route.
 */
export async function exportContactsAction(
  formData: FormData,
): Promise<ExportResult> {
  const resolved = await resolveWorkspace();
  if (!resolved.ok) return { ok: false, error: resolved.error.message };

  const parsed = parseFormData(contactExportSchema, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };

  const filters: ContactFilters = {
    search: parsed.data.search ?? "",
    status: parsed.data.status ?? "active",
    tagId: parsed.data.tagId ?? null,
    sort: parsed.data.sort ?? "recent",
    page: 1,
  };

  const contacts = await listContactsForExport(
    resolved.data.workspace.id,
    filters,
  );

  if (!contacts) {
    return {
      ok: false,
      error: "We could not build that export. Please retry.",
    };
  }
  if (contacts.length === 0) {
    return {
      ok: false,
      error: "There are no contacts matching these filters.",
    };
  }

  const csv = contactsToCsv(
    contacts.map((contact) => ({
      fullName: contact.fullName,
      phoneDisplay: contact.phoneDisplay,
      phoneNormalized: contact.phoneNormalized,
      email: normalizeEmail(contact.email),
      city: contact.city,
      leadSource: contact.leadSource,
      status: contact.status,
      nextFollowUpAt: contact.nextFollowUpAt,
      createdAt: contact.createdAt,
      tags: contact.tags.map((tag) => tag.name),
    })),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    filename: `${resolved.data.workspace.slug}-contacts-${stamp}.csv`,
    csv,
  };
}

/**
 * Used by the contact form to show "this looks like an existing customer"
 * before anything is written. Read-only, so it needs membership, not a write
 * capability.
 */
export async function lookupDuplicateAction(input: {
  phone?: string;
  email?: string;
  excludeContactId?: string;
}): Promise<{ contactId: string; fullName: string; message: string } | null> {
  const resolved = await resolveWorkspace();
  if (!resolved.ok) return null;

  const { workspace } = resolved.data;
  const phone = normalizePhone(input.phone, workspace.country);
  const email = normalizeEmail(input.email);
  if (!phone && !email) return null;

  const supabase = await createClient();
  const match = await findDuplicateContact(supabase, workspace.id, {
    phoneNormalized: phone?.normalized ?? null,
    email,
    excludeContactId: input.excludeContactId,
  });

  if (!match) return null;
  return {
    contactId: match.contactId,
    fullName: match.fullName,
    message: duplicateMessage(match),
  };
}
