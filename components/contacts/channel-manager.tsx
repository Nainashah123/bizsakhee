"use client";

import { useActionState, useId } from "react";
import {
  Instagram,
  Mail,
  MessageCircle,
  Phone,
  Star,
  Trash2,
} from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  addChannelAction,
  removeChannelAction,
  setPrimaryChannelAction,
  type ContactActionState,
} from "@/features/contacts/actions";
import type { ContactChannel } from "@/features/contacts/queries";
import {
  CHANNEL_KINDS,
  CHANNEL_KIND_LABELS,
  type ChannelKindValue,
} from "@/lib/validation/contacts";

const EMPTY: ContactActionState = {};

const CHANNEL_ICONS = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  phone: Phone,
  email: Mail,
  other: MessageCircle,
} as const;

export function ChannelManager({
  contactId,
  channels,
}: {
  contactId: string;
  channels: ContactChannel[];
}) {
  const fieldId = useId();
  const [addState, add] = useActionState(addChannelAction, EMPTY);
  const [primaryState, promote] = useActionState(
    setPrimaryChannelAction,
    EMPTY,
  );
  const [removeState, remove] = useActionState(removeChannelAction, EMPTY);

  return (
    <div className="space-y-4">
      <FormAlert variant="error">
        {addState.error ?? primaryState.error ?? removeState.error}
      </FormAlert>

      {channels.length > 0 ? (
        <ul className="divide-y">
          {channels.map((channel) => {
            const Icon = CHANNEL_ICONS[channel.kind as ChannelKindValue];
            return (
              <li
                key={channel.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0"
              >
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {channel.handle}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {CHANNEL_KIND_LABELS[channel.kind as ChannelKindValue]}
                  </span>
                </span>

                {channel.isPrimary ? (
                  <Badge variant="secondary">
                    <Star aria-hidden="true" />
                    Primary
                  </Badge>
                ) : (
                  <form action={promote}>
                    <input type="hidden" name="contactId" value={contactId} />
                    <input type="hidden" name="channelId" value={channel.id} />
                    <Button type="submit" variant="ghost" className="h-9">
                      <Star aria-hidden="true" />
                      Make primary
                    </Button>
                  </form>
                )}

                <form action={remove}>
                  <input type="hidden" name="contactId" value={contactId} />
                  <input type="hidden" name="channelId" value={channel.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-lg"
                    aria-label={`Remove ${channel.handle}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No channels saved yet. Add the WhatsApp number, Instagram handle or
          email address you actually reach this customer on.
        </p>
      )}

      <form action={add} className="grid gap-3 sm:grid-cols-[9rem_1fr_auto]">
        <input type="hidden" name="contactId" value={contactId} />

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-kind`}>Channel</Label>
          <Select name="kind" defaultValue="whatsapp">
            <SelectTrigger id={`${fieldId}-kind`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {CHANNEL_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-handle`}>Number, handle or address</Label>
          <Input
            id={`${fieldId}-handle`}
            name="handle"
            className="h-11"
            placeholder="+91 98765 43210 or @studio.name"
            aria-describedby={`${fieldId}-handle-error`}
          />
          <FieldError
            id={`${fieldId}-handle-error`}
            messages={addState.fieldErrors?.handle}
          />
        </div>

        <div className="flex items-end">
          <SubmitButton className="h-11 sm:w-auto sm:min-w-32">
            Add channel
          </SubmitButton>
        </div>

        <div className="flex items-center gap-2 sm:col-span-3">
          <Checkbox id={`${fieldId}-primary`} name="isPrimary" />
          <Label htmlFor={`${fieldId}-primary`} className="font-normal">
            Make this the primary way to reach them
          </Label>
        </div>
      </form>
    </div>
  );
}
