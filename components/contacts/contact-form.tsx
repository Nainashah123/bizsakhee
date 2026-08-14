"use client";

import {
  useActionState,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createContactAction,
  lookupDuplicateAction,
  updateContactAction,
  type ContactActionState,
} from "@/features/contacts/actions";
import type { WorkspacePerson } from "@/features/contacts/queries";
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  LEAD_SOURCE_SUGGESTIONS,
  NONE_VALUE,
} from "@/lib/validation/contacts";

const EMPTY: ContactActionState = {};

export type ContactFormDefaults = {
  contactId?: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  leadSource: string;
  status: string;
  assignedTo: string | null;
  nextFollowUpAt: string | null;
};

export const BLANK_CONTACT: ContactFormDefaults = {
  fullName: "",
  phone: "",
  email: "",
  city: "",
  leadSource: "",
  status: "active",
  assignedTo: null,
  nextFollowUpAt: null,
};

/** ISO timestamp -> the "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ContactForm({
  defaults,
  people,
  onSaved,
}: {
  defaults: ContactFormDefaults;
  people: WorkspacePerson[];
  onSaved?: (contactId: string) => void;
}) {
  const isEdit = Boolean(defaults.contactId);
  const [state, submit] = useActionState(
    isEdit ? updateContactAction : createContactAction,
    EMPTY,
  );
  const fieldId = useId();
  const [hint, setHint] = useState<{
    contactId: string;
    message: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (state.contactId && state.message) onSaved?.(state.contactId);
    // `state` is replaced only when an action run completes.
  }, [state, onSaved]);

  const checkDuplicate = (phone: string, email: string) => {
    if (phone.trim() === "" && email.trim() === "") {
      setHint(null);
      return;
    }
    startTransition(async () => {
      const match = await lookupDuplicateAction({
        phone,
        email,
        excludeContactId: defaults.contactId,
      });
      setHint(
        match ? { contactId: match.contactId, message: match.message } : null,
      );
    });
  };

  const conflict = state.conflict;

  return (
    <form action={submit} className="space-y-5" noValidate>
      {defaults.contactId ? (
        <input type="hidden" name="contactId" value={defaults.contactId} />
      ) : null}

      {conflict ? (
        <FormAlert variant="error">
          {state.error}{" "}
          <Link
            href={`/dashboard/contacts/${conflict.contactId}`}
            className="font-medium underline underline-offset-2"
          >
            Open {conflict.fullName}
          </Link>
        </FormAlert>
      ) : (
        <FormAlert variant="error">{state.error}</FormAlert>
      )}
      <FormAlert variant="success">{state.message}</FormAlert>

      {hint && !conflict ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            {hint.message}{" "}
            <Link
              href={`/dashboard/contacts/${hint.contactId}`}
              className="font-medium underline underline-offset-2"
            >
              Open that contact
            </Link>
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-fullName`}>Name</Label>
          <Input
            id={`${fieldId}-fullName`}
            name="fullName"
            defaultValue={defaults.fullName}
            autoComplete="name"
            required
            className="h-11"
            aria-describedby={`${fieldId}-fullName-error`}
          />
          <FieldError
            id={`${fieldId}-fullName-error`}
            messages={state.fieldErrors?.fullName}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-phone`}>Phone or WhatsApp</Label>
          <Input
            id={`${fieldId}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={defaults.phone}
            placeholder="+91 98765 43210"
            className="h-11"
            aria-describedby={`${fieldId}-phone-error`}
            onBlur={(event) => {
              const form = event.currentTarget.form;
              const email =
                (form?.elements.namedItem("email") as HTMLInputElement | null)
                  ?.value ?? "";
              checkDuplicate(event.currentTarget.value, email);
            }}
          />
          <FieldError
            id={`${fieldId}-phone-error`}
            messages={state.fieldErrors?.phone}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-email`}>Email</Label>
          <Input
            id={`${fieldId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={defaults.email}
            className="h-11"
            aria-describedby={`${fieldId}-email-error`}
            onBlur={(event) => {
              const form = event.currentTarget.form;
              const phone =
                (form?.elements.namedItem("phone") as HTMLInputElement | null)
                  ?.value ?? "";
              checkDuplicate(phone, event.currentTarget.value);
            }}
          />
          <FieldError
            id={`${fieldId}-email-error`}
            messages={state.fieldErrors?.email}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-city`}>City</Label>
          <Input
            id={`${fieldId}-city`}
            name="city"
            defaultValue={defaults.city}
            className="h-11"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-leadSource`}>How they found you</Label>
          <Input
            id={`${fieldId}-leadSource`}
            name="leadSource"
            defaultValue={defaults.leadSource}
            list={`${fieldId}-lead-sources`}
            className="h-11"
          />
          <datalist id={`${fieldId}-lead-sources`}>
            {LEAD_SOURCE_SUGGESTIONS.map((source) => (
              <option key={source} value={source} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-nextFollowUpAt`}>Next follow-up</Label>
          <Input
            id={`${fieldId}-nextFollowUpAt`}
            name="nextFollowUpAt"
            type="datetime-local"
            defaultValue={toLocalInputValue(defaults.nextFollowUpAt)}
            className="h-11"
            aria-describedby={`${fieldId}-nextFollowUpAt-error`}
          />
          <FieldError
            id={`${fieldId}-nextFollowUpAt-error`}
            messages={state.fieldErrors?.nextFollowUpAt}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-assignedTo`}>Looked after by</Label>
          <Select
            name="assignedTo"
            defaultValue={defaults.assignedTo ?? NONE_VALUE}
          >
            <SelectTrigger id={`${fieldId}-assignedTo`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Nobody yet</SelectItem>
              {people.map((person) => (
                <SelectItem key={person.userId} value={person.userId}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError
            id={`${fieldId}-assignedTo-error`}
            messages={state.fieldErrors?.assignedTo}
          />
        </div>

        {isEdit ? (
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-status`}>Status</Label>
            <Select name="status" defaultValue={defaults.status}>
              <SelectTrigger id={`${fieldId}-status`} className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {CONTACT_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <SubmitButton className="sm:w-auto sm:min-w-40">
        {isEdit ? "Save changes" : "Add customer"}
      </SubmitButton>
    </form>
  );
}
