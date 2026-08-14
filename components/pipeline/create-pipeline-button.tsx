"use client";

import { useActionState } from "react";
import { KanbanSquare } from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import {
  createDefaultPipelineAction,
  type PipelineActionState,
} from "@/features/pipeline/actions";

const EMPTY: PipelineActionState = {};

export function CreatePipelineButton() {
  const [state, submit] = useActionState(createDefaultPipelineAction, EMPTY);

  return (
    <form action={submit} className="space-y-2">
      <FormAlert variant="error">{state.error}</FormAlert>
      <FormAlert variant="success">{state.message}</FormAlert>
      <SubmitButton className="h-11 sm:w-auto sm:min-w-56">
        <KanbanSquare aria-hidden="true" />
        Set up my pipeline
      </SubmitButton>
    </form>
  );
}
