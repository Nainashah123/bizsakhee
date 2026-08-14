"use client";

import { useActionState } from "react";
import { ArchiveRestore, ArchiveX } from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import {
  setContactStatusAction,
  type ContactActionState,
} from "@/features/contacts/actions";
import type { ContactStatus } from "@/lib/validation/contacts";

const EMPTY: ContactActionState = {};

/** Archiving is reversible, so it is a status flip rather than a delete. */
export function ContactStatusButton({
  contactId,
  status,
}: {
  contactId: string;
  status: ContactStatus;
}) {
  const [state, submit] = useActionState(setContactStatusAction, EMPTY);
  const archiving = status === "active";

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="contactId" value={contactId} />
      <input
        type="hidden"
        name="status"
        value={archiving ? "archived" : "active"}
      />
      <FormAlert variant="error">{state.error}</FormAlert>
      <SubmitButton
        variant={archiving ? "destructive" : "outline"}
        className="h-10 sm:w-auto sm:min-w-40"
      >
        {archiving ? (
          <>
            <ArchiveX aria-hidden="true" />
            Archive
          </>
        ) : (
          <>
            <ArchiveRestore aria-hidden="true" />
            Restore
          </>
        )}
      </SubmitButton>
    </form>
  );
}
