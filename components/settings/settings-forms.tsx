"use client";

import { useActionState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  updateProfileAction,
  updateWorkspaceSettingsAction,
  type SettingsState,
} from "@/features/workspace/actions";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_LABELS,
  LANGUAGES,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
} from "@/lib/validation/onboarding";

const EMPTY: SettingsState = {};

export type WorkspaceSettingsDefaults = {
  name: string;
  currency: string;
  isCataloguePublic: boolean;
  businessName: string;
  category: string;
  primaryChannel: string;
  city: string;
  whatsappNumber: string;
  description: string;
};

export function WorkspaceSettingsForm({
  defaults,
  canEdit,
}: {
  defaults: WorkspaceSettingsDefaults;
  canEdit: boolean;
}) {
  const [state, submit] = useActionState(updateWorkspaceSettingsAction, EMPTY);

  return (
    <form action={submit} className="space-y-5" noValidate>
      <FormAlert variant="error">{state.error}</FormAlert>
      <FormAlert variant="success">{state.message}</FormAlert>

      <fieldset disabled={!canEdit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Workspace name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={defaults.name}
              className="h-11"
              aria-describedby="name-error"
            />
            <FieldError id="name-error" messages={state.fieldErrors?.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="businessName">Business name</Label>
            <Input
              id="businessName"
              name="businessName"
              defaultValue={defaults.businessName}
              className="h-11"
              aria-describedby="businessName-error"
            />
            <FieldError
              id="businessName-error"
              messages={state.fieldErrors?.businessName}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select name="category" defaultValue={defaults.category}>
              <SelectTrigger id="category" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {BUSINESS_CATEGORY_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="primaryChannel">Main sales channel</Label>
            <Select
              name="primaryChannel"
              defaultValue={defaults.primaryChannel}
            >
              <SelectTrigger id="primaryChannel" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_CHANNELS.map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {SALES_CHANNEL_LABELS[channel]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              name="city"
              defaultValue={defaults.city}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="whatsappNumber">WhatsApp number</Label>
            <Input
              id="whatsappNumber"
              name="whatsappNumber"
              type="tel"
              inputMode="tel"
              defaultValue={defaults.whatsappNumber}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Select name="currency" defaultValue={defaults.currency}>
              <SelectTrigger id="currency" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">About your business</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={defaults.description}
            placeholder="One or two lines customers will see on your catalogue."
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="isCataloguePublic" className="font-medium">
              Public catalogue
            </Label>
            <p className="text-sm text-muted-foreground">
              When on, published products are visible to anyone with your
              catalogue link. Drafts stay private either way.
            </p>
          </div>
          <Switch
            id="isCataloguePublic"
            name="isCataloguePublic"
            defaultChecked={defaults.isCataloguePublic}
          />
        </div>

        {canEdit ? (
          <SubmitButton className="sm:w-auto sm:min-w-40">
            Save changes
          </SubmitButton>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only workspace owners and admins can change these settings.
          </p>
        )}
      </fieldset>
    </form>
  );
}

export function ProfileSettingsForm({
  fullName,
  preferredLanguage,
}: {
  fullName: string;
  preferredLanguage: string;
}) {
  const [state, submit] = useActionState(updateProfileAction, EMPTY);

  return (
    <form action={submit} className="space-y-5" noValidate>
      <FormAlert variant="error">{state.error}</FormAlert>
      <FormAlert variant="success">{state.message}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Your name</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={fullName}
            className="h-11"
            aria-describedby="fullName-error"
          />
          <FieldError
            id="fullName-error"
            messages={state.fieldErrors?.fullName}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="preferredLanguage">Preferred language</Label>
          <Select name="preferredLanguage" defaultValue={preferredLanguage}>
            <SelectTrigger id="preferredLanguage" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.value} value={language.value}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <SubmitButton className="sm:w-auto sm:min-w-40">
        Save profile
      </SubmitButton>
    </form>
  );
}
