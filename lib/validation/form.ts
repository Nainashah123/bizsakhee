import type { z } from "zod";

import { err, ok, type Result } from "@/lib/result";

/** Flattens a Zod error into the `fieldErrors` shape forms render. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * Validates a FormData payload. Only keys declared in the schema survive, so a
 * caller cannot smuggle extra fields into a database write (mass assignment).
 */
export function parseFormData<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
): Result<z.output<Schema>> {
  const raw: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};

  for (const [key, value] of formData.entries()) {
    const existing = raw[key];
    if (existing === undefined) {
      raw[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      raw[key] = [existing, value];
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return err(
      "validation",
      "Please check the highlighted fields.",
      fieldErrorsFrom(parsed.error),
    );
  }

  return ok(parsed.data);
}
