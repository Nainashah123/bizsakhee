"use client";

import { useActionState, useId } from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  attachTagAction,
  createTagAction,
  detachTagAction,
  type ContactActionState,
} from "@/features/contacts/actions";
import type { ContactTag } from "@/features/contacts/queries";
import { TAG_COLORS, TAG_COLOR_LABELS } from "@/lib/validation/contacts";

const EMPTY: ContactActionState = {};

export function TagManager({
  contactId,
  tags,
  allTags,
}: {
  contactId: string;
  tags: ContactTag[];
  allTags: { id: string; name: string }[];
}) {
  const fieldId = useId();
  const [attachState, attach] = useActionState(attachTagAction, EMPTY);
  const [detachState, detach] = useActionState(detachTagAction, EMPTY);
  const [createState, create] = useActionState(createTagAction, EMPTY);

  const attachedIds = new Set(tags.map((tag) => tag.id));
  const available = allTags.filter((tag) => !attachedIds.has(tag.id));

  return (
    <div className="space-y-4">
      <FormAlert variant="error">
        {attachState.error ?? detachState.error ?? createState.error}
      </FormAlert>

      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <form action={detach} className="inline-flex">
                <input type="hidden" name="contactId" value={contactId} />
                <input type="hidden" name="tagId" value={tag.id} />
                <Badge variant="secondary" className="h-8 gap-1 pr-1 pl-2.5">
                  <TagIcon aria-hidden="true" />
                  {tag.name}
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove tag ${tag.name}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </Badge>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No tags yet. Tags make it quick to find a group of customers later.
        </p>
      )}

      {available.length > 0 ? (
        <form action={attach} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="contactId" value={contactId} />
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor={`${fieldId}-existing`}>Add an existing tag</Label>
            <Select name="tagId" defaultValue={available[0].id}>
              <SelectTrigger id={`${fieldId}-existing`} className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SubmitButton className="h-11 sm:w-auto sm:min-w-28">
            Add
          </SubmitButton>
        </form>
      ) : null}

      <form action={create} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="contactId" value={contactId} />
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label htmlFor={`${fieldId}-name`}>Create a new tag</Label>
          <Input
            id={`${fieldId}-name`}
            name="name"
            placeholder="VIP, wholesale, bridal..."
            className="h-11"
            aria-describedby={`${fieldId}-name-error`}
          />
          <FieldError
            id={`${fieldId}-name-error`}
            messages={createState.fieldErrors?.name}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <Label htmlFor={`${fieldId}-color`}>Colour</Label>
          <Select name="color" defaultValue="plum">
            <SelectTrigger id={`${fieldId}-color`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAG_COLORS.map((color) => (
                <SelectItem key={color} value={color}>
                  {TAG_COLOR_LABELS[color]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SubmitButton className="h-11 sm:w-auto sm:min-w-36">
          <Plus aria-hidden="true" />
          Create tag
        </SubmitButton>
      </form>
    </div>
  );
}
