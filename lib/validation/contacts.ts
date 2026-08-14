import { z } from "zod";

/**
 * Contact, tag, note, channel, import and pipeline input schemas.
 *
 * Every Server Action in `features/contacts` and `features/pipeline` parses its
 * FormData through one of these, so a crafted form cannot smuggle extra columns
 * into a write. `workspace_id` deliberately appears in none of them - it is
 * always resolved from the session.
 */

export const CONTACT_STATUSES = ["active", "archived"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  active: "Active",
  archived: "Archived",
};

export const CHANNEL_KINDS = [
  "whatsapp",
  "instagram",
  "phone",
  "email",
  "other",
] as const;
export type ChannelKindValue = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_KIND_LABELS: Record<ChannelKindValue, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  phone: "Phone",
  email: "Email",
  other: "Other",
};

/** Suggestions only - `lead_source` is free text so nothing is rejected. */
export const LEAD_SOURCE_SUGGESTIONS = [
  "WhatsApp",
  "Instagram",
  "Referral",
  "Walk-in",
  "Exhibition",
  "Website",
  "Repeat customer",
] as const;

export const TAG_COLORS = ["plum", "violet", "lime", "amber", "slate"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  plum: "Plum",
  violet: "Violet",
  lime: "Lime",
  amber: "Amber",
  slate: "Slate",
};

export const CONTACT_SORTS = ["recent", "name", "follow_up"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export const CONTACT_SORT_LABELS: Record<ContactSort, string> = {
  recent: "Newest first",
  name: "Name A-Z",
  follow_up: "Follow-up due first",
};

export const CONTACT_STATUS_FILTERS = ["active", "archived", "all"] as const;
export type ContactStatusFilter = (typeof CONTACT_STATUS_FILTERS)[number];

export const CONTACT_PAGE_SIZE = 20;
/** Sentinel used by `<Select>`, which cannot hold an empty string value. */
export const NONE_VALUE = "none";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === undefined || value === "" || value === NONE_VALUE
      ? undefined
      : value,
  )
  .refine(
    (value) =>
      value === undefined ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
    "That selection is not valid",
  );

const optionalEmail = z
  .string()
  .trim()
  .max(254, "Email is too long")
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => value === undefined || z.email().safeParse(value).success,
    "Enter a valid email address",
  )
  .transform((value) => value?.toLowerCase());

/** `datetime-local` posts "2026-08-20T10:30"; blank means "no follow-up". */
const optionalDateTime = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => value === undefined || !Number.isNaN(Date.parse(value)),
    "Enter a valid date and time",
  );

const optionalDate = z
  .string()
  .trim()
  .max(20)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Enter a valid date",
  );

const checkbox = z
  // An unchecked checkbox submits NOTHING, so the key is absent from FormData.
  // z.union([..., z.undefined()]) does not make a key optional in Zod 4 - the
  // field is still required and a missing key fails with "expected
  // nonoptional". .optional() is what actually permits the absent key.
  .union([z.literal("on"), z.literal("true"), z.literal("false")])
  .optional()
  .transform((value) => value === "on" || value === "true");

const uuidField = (message: string) =>
  z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      message,
    );

export const contactFieldsSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Enter a name")
    .max(160, "That name is too long"),
  phone: optionalText(24),
  email: optionalEmail,
  city: optionalText(80),
  leadSource: optionalText(60),
  status: z.enum(CONTACT_STATUSES).optional(),
  assignedTo: optionalUuid,
  nextFollowUpAt: optionalDateTime,
});

export const contactCreateSchema = contactFieldsSchema;

export const contactUpdateSchema = contactFieldsSchema.extend({
  contactId: uuidField("We could not tell which contact to update"),
});

export const contactArchiveSchema = z.object({
  contactId: uuidField("We could not tell which contact to update"),
  status: z.enum(CONTACT_STATUSES),
});

export const noteCreateSchema = z.object({
  contactId: uuidField("We could not tell which contact this note belongs to"),
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(4000, "That note is too long"),
});

export const tagCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the tag a name")
    .max(40, "Keep tag names short"),
  color: z.enum(TAG_COLORS).optional(),
  /** When present the new tag is attached to this contact straight away. */
  contactId: optionalUuid,
});

export const contactTagSchema = z.object({
  contactId: uuidField("We could not tell which contact to update"),
  tagId: uuidField("We could not tell which tag to use"),
});

export const channelCreateSchema = z.object({
  contactId: uuidField("We could not tell which contact to update"),
  kind: z.enum(CHANNEL_KINDS, { message: "Pick a channel" }),
  handle: z
    .string()
    .trim()
    .min(2, "Enter the number, handle or address")
    .max(160, "That value is too long"),
  isPrimary: checkbox,
});

export const channelDeleteSchema = z.object({
  contactId: uuidField("We could not tell which contact to update"),
  channelId: uuidField("We could not tell which channel to remove"),
});

export const channelPrimarySchema = channelDeleteSchema;

/**
 * The browser reads the chosen file and posts its text, so preview and confirm
 * validate exactly the same payload.
 */
export const csvImportSchema = z.object({
  csv: z
    .string()
    .min(1, "Choose a CSV file first")
    .max(
      1_000_000,
      "That file is larger than 1 MB. Split it into smaller files.",
    ),
});

export const contactExportSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(CONTACT_STATUS_FILTERS).optional(),
  tagId: optionalUuid,
  sort: z.enum(CONTACT_SORTS).optional(),
});

export const opportunityMoveSchema = z.object({
  opportunityId: uuidField("We could not tell which deal to move"),
  stageId: uuidField("Pick a stage"),
});

export const opportunityCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give this deal a name")
    .max(160, "That name is too long"),
  stageId: uuidField("Pick a stage"),
  contactId: optionalUuid,
  value: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .refine(
      (value) => value === undefined || /^\d+(\.\d{1,2})?$/.test(value),
      "Enter an amount like 2500 or 2500.50",
    ),
  expectedCloseOn: optionalDate,
});

export type ContactFieldsInput = z.infer<typeof contactFieldsSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;

export type ContactFilters = {
  search: string;
  status: ContactStatusFilter;
  tagId: string | null;
  sort: ContactSort;
  page: number;
};

const filterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(CONTACT_STATUS_FILTERS).optional(),
  tag: optionalUuid,
  sort: z.enum(CONTACT_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Search params are user input too. Anything unrecognised falls back to the
 * default rather than erroring - a bad bookmark should still render a list.
 */
export function parseContactFilters(
  params: Record<string, string | string[] | undefined>,
): ContactFilters {
  const parsed = filterSchema.safeParse({
    q: firstValue(params.q),
    status: firstValue(params.status),
    tag: firstValue(params.tag),
    sort: firstValue(params.sort),
    page: firstValue(params.page),
  });

  if (!parsed.success) {
    return {
      search: "",
      status: "active",
      tagId: null,
      sort: "recent",
      page: 1,
    };
  }

  return {
    search: parsed.data.q ?? "",
    status: parsed.data.status ?? "active",
    tagId: parsed.data.tag ?? null,
    sort: parsed.data.sort ?? "recent",
    page: parsed.data.page ?? 1,
  };
}

/** Rebuilds a `/dashboard/contacts` query string from filters. */
export function contactFiltersToQuery(
  filters: Partial<ContactFilters>,
): string {
  const search = new URLSearchParams();
  if (filters.search) search.set("q", filters.search);
  if (filters.status && filters.status !== "active") {
    search.set("status", filters.status);
  }
  if (filters.tagId) search.set("tag", filters.tagId);
  if (filters.sort && filters.sort !== "recent")
    search.set("sort", filters.sort);
  if (filters.page && filters.page > 1)
    search.set("page", String(filters.page));
  const value = search.toString();
  return value === "" ? "" : `?${value}`;
}
