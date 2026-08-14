/**
 * CSV import and export for contacts.
 *
 * Everything here is pure: parsing, header mapping, row classification and
 * duplicate matching all run identically in a unit test, in a Server Action and
 * (for the download) in the browser. The database is never touched from this
 * module - callers pass in the existing contacts they want matched against.
 */

import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
} from "@/lib/contacts/normalize";
import {
  CONTACT_STATUSES,
  type ContactStatus,
} from "@/lib/validation/contacts";

export type CsvRecord = {
  /** 1-based line number in the original file, header included. */
  line: number;
  cells: string[];
};

export type CsvDocument = {
  headers: string[];
  records: CsvRecord[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * RFC 4180 reader: quoted fields may contain commas, newlines and doubled
 * quotes. An unterminated quote is not an error here - the remainder of the
 * file becomes the final field, and the row-count check flags it downstream.
 */
export function parseCsv(text: string): CsvDocument {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  const lines: number[] = [];

  let cells: string[] = [];
  let value = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let started = false;

  const pushCell = () => {
    cells.push(value);
    value = "";
  };

  const pushRow = () => {
    pushCell();
    // A row of a single empty cell is a blank line, not a record.
    if (!(cells.length === 1 && cells[0].trim() === "")) {
      rows.push(cells);
      lines.push(rowLine);
    }
    cells = [];
    started = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (!started) {
      rowLine = line;
      started = true;
    }

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        value += char;
      }
      continue;
    }

    if (char === '"' && value === "") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      pushCell();
      continue;
    }

    if (char === "\r") continue;

    if (char === "\n") {
      pushRow();
      line += 1;
      continue;
    }

    value += char;
  }

  if (started || value !== "" || cells.length > 0) pushRow();

  const [headerRow, ...bodyRows] = rows;
  if (!headerRow) return { headers: [], records: [] };

  return {
    headers: headerRow.map((header) => header.trim()),
    records: bodyRows.map((cellValues, index) => ({
      line: lines[index + 1],
      cells: cellValues,
    })),
  };
}

export const CONTACT_CSV_FIELDS = [
  "fullName",
  "phone",
  "email",
  "city",
  "leadSource",
  "status",
  "nextFollowUpAt",
  "tags",
] as const;
export type ContactCsvField = (typeof CONTACT_CSV_FIELDS)[number];

const HEADER_ALIASES: Record<string, ContactCsvField> = {
  name: "fullName",
  "full name": "fullName",
  fullname: "fullName",
  contact: "fullName",
  "contact name": "fullName",
  customer: "fullName",
  "customer name": "fullName",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "mobile number": "phone",
  whatsapp: "phone",
  "whatsapp number": "phone",
  number: "phone",
  email: "email",
  "email address": "email",
  "e mail": "email",
  city: "city",
  town: "city",
  location: "city",
  source: "leadSource",
  "lead source": "leadSource",
  "how they found us": "leadSource",
  status: "status",
  "follow up": "nextFollowUpAt",
  "next follow up": "nextFollowUpAt",
  "follow up date": "nextFollowUpAt",
  tags: "tags",
  tag: "tags",
  labels: "tags",
};

/** Lowercase, collapse whitespace and drop punctuation so "E-Mail" maps. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
}

export type HeaderMap = Partial<Record<ContactCsvField, number>>;

export function mapHeaders(headers: string[]): HeaderMap {
  const map: HeaderMap = {};
  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeader(header)];
    if (field && map[field] === undefined) map[field] = index;
  });
  return map;
}

export type ExistingContactKey = {
  id: string;
  fullName: string;
  phoneNormalized: string | null;
  emailNormalized: string | null;
};

export type DedupeIndex = {
  byPhone: Map<string, { id: string; fullName: string }>;
  byEmail: Map<string, { id: string; fullName: string }>;
};

export function buildDedupeIndex(
  existing: readonly ExistingContactKey[],
): DedupeIndex {
  const byPhone = new Map<string, { id: string; fullName: string }>();
  const byEmail = new Map<string, { id: string; fullName: string }>();

  for (const contact of existing) {
    const entry = { id: contact.id, fullName: contact.fullName };
    // First writer wins: the oldest contact stays the canonical record.
    if (contact.phoneNormalized && !byPhone.has(contact.phoneNormalized)) {
      byPhone.set(contact.phoneNormalized, entry);
    }
    if (contact.emailNormalized && !byEmail.has(contact.emailNormalized)) {
      byEmail.set(contact.emailNormalized, entry);
    }
  }

  return { byPhone, byEmail };
}

export type DuplicateHit = {
  field: "phone" | "email";
  contactId: string;
  fullName: string;
};

/**
 * Matches a candidate against the index on normalised phone first, then email.
 * The candidate's values are raw user input - "+91 98765 43210" and
 * "098765-43210" both find the contact stored as "919876543210".
 */
export function findDuplicate(
  candidate: { phone?: string | null; email?: string | null },
  index: DedupeIndex,
  defaultCountry = "IN",
): DuplicateHit | null {
  const phone = normalizePhone(candidate.phone, defaultCountry)?.normalized;
  if (phone) {
    const hit = index.byPhone.get(phone);
    if (hit)
      return { field: "phone", contactId: hit.id, fullName: hit.fullName };
  }

  const email = normalizeEmail(candidate.email);
  if (email) {
    const hit = index.byEmail.get(email);
    if (hit)
      return { field: "email", contactId: hit.id, fullName: hit.fullName };
  }

  return null;
}

export type ImportCandidate = {
  line: number;
  fullName: string;
  phoneNormalized: string | null;
  phoneDisplay: string | null;
  email: string | null;
  city: string | null;
  leadSource: string | null;
  status: ContactStatus;
  nextFollowUpAt: string | null;
  tags: string[];
};

export type InvalidImportRow = {
  line: number;
  label: string;
  reasons: string[];
};

export type DuplicateImportRow = {
  line: number;
  label: string;
  reason: string;
  /** Null when the clash is with another row in the same file. */
  contactId: string | null;
};

export type ImportClassification = {
  valid: ImportCandidate[];
  invalid: InvalidImportRow[];
  duplicates: DuplicateImportRow[];
};

function cellAt(record: CsvRecord, index: number | undefined): string {
  if (index === undefined) return "";
  return (record.cells[index] ?? "").trim();
}

function splitTags(value: string): string[] {
  return value
    .split(/[;|]/)
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .slice(0, 10);
}

/**
 * Sorts every data row into valid / invalid / duplicate.
 *
 * A row is only reported once: a malformed row is never also reported as a
 * duplicate, because we do not trust its parsed values enough to compare them.
 * Duplicates are detected against the workspace *and* against rows already
 * accepted from the same file, so a file that repeats a number imports once.
 */
export function classifyImportRows(
  document: CsvDocument,
  options: {
    existing: readonly ExistingContactKey[];
    defaultCountry?: string;
    maxRows?: number;
  },
): ImportClassification {
  const country = options.defaultCountry ?? "IN";
  const maxRows = options.maxRows ?? 1000;
  const headerMap = mapHeaders(document.headers);
  const columnCount = document.headers.length;

  const index = buildDedupeIndex(options.existing);
  const seenNames = new Set<string>();

  const valid: ImportCandidate[] = [];
  const invalid: InvalidImportRow[] = [];
  const duplicates: DuplicateImportRow[] = [];

  for (const record of document.records) {
    if (valid.length + invalid.length + duplicates.length >= maxRows) {
      invalid.push({
        line: record.line,
        label: `Row ${record.line}`,
        reasons: [
          `Only the first ${maxRows} rows are imported at a time. Split the file and import the rest separately.`,
        ],
      });
      break;
    }

    const fullName = cellAt(record, headerMap.fullName);
    const label = fullName || `Row ${record.line}`;
    const reasons: string[] = [];

    if (headerMap.fullName === undefined) {
      reasons.push("This file has no name column.");
    }
    if (record.cells.length !== columnCount) {
      reasons.push(
        `Expected ${columnCount} column${columnCount === 1 ? "" : "s"} but found ${record.cells.length}.`,
      );
    }
    if (fullName === "") {
      reasons.push("Name is missing.");
    } else if (fullName.length > 160) {
      reasons.push("Name is longer than 160 characters.");
    }

    const rawPhone = cellAt(record, headerMap.phone);
    const phone = rawPhone === "" ? null : normalizePhone(rawPhone, country);
    if (rawPhone !== "" && !phone) {
      reasons.push(`"${rawPhone}" is not a phone number we can dial.`);
    }

    const rawEmail = cellAt(record, headerMap.email);
    if (rawEmail !== "" && !EMAIL_PATTERN.test(rawEmail)) {
      reasons.push(`"${rawEmail}" is not a valid email address.`);
    }
    const email = rawEmail !== "" ? normalizeEmail(rawEmail) : null;

    const rawStatus = cellAt(record, headerMap.status).toLowerCase();
    if (
      rawStatus !== "" &&
      !(CONTACT_STATUSES as readonly string[]).includes(rawStatus)
    ) {
      reasons.push(`"${rawStatus}" is not a status. Use active or archived.`);
    }

    const rawFollowUp = cellAt(record, headerMap.nextFollowUpAt);
    if (rawFollowUp !== "" && Number.isNaN(Date.parse(rawFollowUp))) {
      reasons.push(`"${rawFollowUp}" is not a date we understand.`);
    }

    if (reasons.length > 0) {
      invalid.push({ line: record.line, label, reasons });
      continue;
    }

    const hit = findDuplicate(
      { phone: rawPhone, email: rawEmail },
      index,
      country,
    );
    if (hit) {
      const inFile = hit.contactId.startsWith("csv:");
      const what = hit.field === "phone" ? "phone number" : "email address";
      duplicates.push({
        line: record.line,
        label,
        reason: inFile
          ? `Same ${what} as ${hit.fullName} earlier in this file.`
          : `Same ${what} as ${hit.fullName}, who is already saved.`,
        contactId: inFile ? null : hit.contactId,
      });
      continue;
    }

    // Two rows with the same name and no phone or email would silently become
    // two contacts; flag the repeat instead of importing it twice.
    const nameKey = normalizeName(fullName);
    if (!phone && !email && seenNames.has(nameKey)) {
      duplicates.push({
        line: record.line,
        label,
        reason: "This name already appears earlier in the file.",
        contactId: null,
      });
      continue;
    }
    seenNames.add(nameKey);

    const candidate: ImportCandidate = {
      line: record.line,
      fullName,
      phoneNormalized: phone?.normalized ?? null,
      phoneDisplay: phone?.display ?? null,
      email,
      city: cellAt(record, headerMap.city) || null,
      leadSource: cellAt(record, headerMap.leadSource) || null,
      status: rawStatus === "archived" ? "archived" : "active",
      nextFollowUpAt:
        rawFollowUp === "" ? null : new Date(rawFollowUp).toISOString(),
      tags: splitTags(cellAt(record, headerMap.tags)),
    };

    valid.push(candidate);

    // Accepted rows join the index under a synthetic id so a later row in the
    // same file is reported as a duplicate of this one.
    const entry = { id: `csv:${record.line}`, fullName };
    if (candidate.phoneNormalized) {
      index.byPhone.set(candidate.phoneNormalized, entry);
    }
    if (candidate.email) index.byEmail.set(candidate.email, entry);
  }

  return { valid, invalid, duplicates };
}

/**
 * Quotes a cell when it contains a delimiter, a quote or leading/trailing
 * space, and neutralises formula injection - a cell opening with =, +, - or @
 * is executed by spreadsheet software when the file is opened.
 */
export function escapeCsvCell(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (string | number | null | undefined)[][],
): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  // CRLF is what Excel expects; every reader accepts it.
  return `${lines.join("\r\n")}\r\n`;
}

export const CONTACT_EXPORT_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "City",
  "Lead source",
  "Status",
  "Next follow up",
  "Tags",
  "Created",
] as const;

export type ExportableContact = {
  fullName: string;
  phoneDisplay: string | null;
  phoneNormalized: string | null;
  email: string | null;
  city: string | null;
  leadSource: string | null;
  status: string;
  nextFollowUpAt: string | null;
  createdAt: string;
  tags: string[];
};

export function contactsToCsv(contacts: readonly ExportableContact[]): string {
  return toCsv(
    CONTACT_EXPORT_HEADERS,
    contacts.map((contact) => [
      contact.fullName,
      contact.phoneDisplay ?? contact.phoneNormalized ?? "",
      contact.email ?? "",
      contact.city ?? "",
      contact.leadSource ?? "",
      contact.status,
      contact.nextFollowUpAt ?? "",
      contact.tags.join("; "),
      contact.createdAt,
    ]),
  );
}

/** The header row we hand out as a starting point for an import. */
export const CONTACT_IMPORT_TEMPLATE = toCsv(
  ["Name", "Phone", "Email", "City", "Lead source", "Tags"],
  [
    [
      "Meera Nair",
      "+91 98765 43210",
      "meera@example.com",
      "Kochi",
      "Instagram",
      "vip; repeat",
    ],
  ],
);
