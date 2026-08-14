"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { StickyNote } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addNoteAction,
  type ContactActionState,
} from "@/features/contacts/actions";

const EMPTY: ContactActionState = {};

export function NoteComposer({ contactId }: { contactId: string }) {
  const fieldId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, submit] = useActionState(addNoteAction, EMPTY);

  useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={submit} className="space-y-3" noValidate>
      <input type="hidden" name="contactId" value={contactId} />

      <FormAlert variant="error">{state.error}</FormAlert>
      <FormAlert variant="success">{state.message}</FormAlert>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-body`}>Add a note</Label>
        <Textarea
          id={`${fieldId}-body`}
          name="body"
          rows={3}
          placeholder="What did you agree? What should you remember next time?"
          aria-describedby={`${fieldId}-body-error`}
        />
        <FieldError
          id={`${fieldId}-body-error`}
          messages={state.fieldErrors?.body}
        />
      </div>

      <SubmitButton className="h-11 sm:w-auto sm:min-w-36">
        <StickyNote aria-hidden="true" />
        Save note
      </SubmitButton>
    </form>
  );
}
