"use client";

import { useActionState, useId } from "react";
import { ArrowRightLeft } from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  moveOpportunityAction,
  type PipelineActionState,
} from "@/features/pipeline/actions";

const EMPTY: PipelineActionState = {};

/**
 * The accessible, non-pointer way to move a deal: a labelled select plus a
 * submit button on every card, reachable by keyboard and screen reader. It is
 * the primary path, not a fallback behind drag and drop.
 */
export function MoveStageForm({
  opportunityId,
  title,
  currentStageId,
  stages,
}: {
  opportunityId: string;
  title: string;
  currentStageId: string;
  stages: { id: string; name: string }[];
}) {
  const fieldId = useId();
  const [state, submit] = useActionState(moveOpportunityAction, EMPTY);

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />

      <label htmlFor={fieldId} className="sr-only">
        Move &ldquo;{title}&rdquo; to stage
      </label>

      <div className="flex gap-2">
        <Select name="stageId" defaultValue={currentStageId}>
          <SelectTrigger
            id={fieldId}
            className="h-10 w-full"
            aria-label={`Move ${title} to stage`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <SubmitButton variant="secondary" className="h-10 w-auto shrink-0 px-3">
          <ArrowRightLeft aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Move</span>
        </SubmitButton>
      </div>

      <FormAlert variant="error">{state.error}</FormAlert>
      {state.message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
