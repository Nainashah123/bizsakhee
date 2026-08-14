"use client";

import { useActionState, useId, useState } from "react";
import { Plus } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  createOpportunityAction,
  type PipelineActionState,
} from "@/features/pipeline/actions";
import { NONE_VALUE } from "@/lib/validation/contacts";

const EMPTY: PipelineActionState = {};

export function NewDealDialog({
  stages,
  contacts,
  currency,
  defaultStageId,
  triggerLabel = "Add a deal",
  triggerVariant,
}: {
  stages: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  currency: string;
  defaultStageId: string;
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [state, submit] = useActionState(createOpportunityAction, EMPTY);

  // Close on a successful submit by reacting to the new action state during
  // render rather than in an effect, which would cause a cascading render.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.message) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className="h-10">
          <Plus aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a deal</DialogTitle>
          <DialogDescription>
            A deal is one enquiry you are working on. Move it through the stages
            as it progresses.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="space-y-4" noValidate>
          <FormAlert variant="error">{state.error}</FormAlert>

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-title`}>What is it for?</Label>
            <Input
              id={`${fieldId}-title`}
              name="title"
              required
              className="h-11"
              placeholder="Festive lehenga order"
              aria-describedby={`${fieldId}-title-error`}
            />
            <FieldError
              id={`${fieldId}-title-error`}
              messages={state.fieldErrors?.title}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-stage`}>Stage</Label>
              <Select name="stageId" defaultValue={defaultStageId}>
                <SelectTrigger id={`${fieldId}-stage`} className="h-11 w-full">
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
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-contact`}>Customer</Label>
              <Select name="contactId" defaultValue={NONE_VALUE}>
                <SelectTrigger
                  id={`${fieldId}-contact`}
                  className="h-11 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Not linked yet</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-value`}>
                Expected value ({currency})
              </Label>
              <Input
                id={`${fieldId}-value`}
                name="value"
                inputMode="decimal"
                placeholder="2500"
                className="h-11"
                aria-describedby={`${fieldId}-value-error`}
              />
              <FieldError
                id={`${fieldId}-value-error`}
                messages={state.fieldErrors?.value}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-close`}>Expected close date</Label>
              <Input
                id={`${fieldId}-close`}
                name="expectedCloseOn"
                type="date"
                className="h-11"
                aria-describedby={`${fieldId}-close-error`}
              />
              <FieldError
                id={`${fieldId}-close-error`}
                messages={state.fieldErrors?.expectedCloseOn}
              />
            </div>
          </div>

          <SubmitButton className="h-11 sm:w-auto sm:min-w-40">
            Save deal
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
