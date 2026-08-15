"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
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
  completeOnboardingAction,
  type OnboardingState,
} from "@/features/onboarding/actions";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/geo/countries";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_LABELS,
  LANGUAGES,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
} from "@/lib/validation/onboarding";

const EMPTY: OnboardingState = {};

const STEPS = ["You", "Your business", "How you sell"] as const;

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, submit] = useActionState(completeOnboardingAction, EMPTY);
  const [step, setStep] = useState(0);

  return (
    <form action={submit} className="space-y-6" noValidate>
      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={index === step ? "step" : undefined}
              className={
                index <= step
                  ? "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  : "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
              }
            >
              {index + 1}
            </span>
            <span
              className={
                index === step
                  ? "text-sm font-medium"
                  : "hidden text-sm text-muted-foreground sm:inline"
              }
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <FormAlert variant="error">{state.error}</FormAlert>

      {/* All fields stay mounted so a step change never drops entered values. */}
      <div className={step === 0 ? "space-y-4" : "hidden"}>
        <div className="space-y-2">
          <Label htmlFor="fullName">What should we call you?</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={defaultName}
            autoComplete="name"
            className="h-11"
            aria-describedby="fullName-error"
          />
          <FieldError
            id="fullName-error"
            messages={state.fieldErrors?.fullName}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="language">Preferred language</Label>
          <Select name="language" defaultValue="en">
            <SelectTrigger id="language" className="h-11 w-full">
              <SelectValue placeholder="Choose a language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.value} value={language.value}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Used for AI drafts. The app itself is in English for now.
          </p>
        </div>
      </div>

      <div className={step === 1 ? "space-y-4" : "hidden"}>
        <div className="space-y-2">
          <Label htmlFor="businessName">Business name</Label>
          <Input
            id="businessName"
            name="businessName"
            className="h-11"
            aria-describedby="businessName-error"
          />
          <FieldError
            id="businessName-error"
            messages={state.fieldErrors?.businessName}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">What do you sell?</Label>
          <Select name="category" defaultValue="boutique">
            <SelectTrigger id="category" className="h-11 w-full">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {BUSINESS_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {BUSINESS_CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError
            id="category-error"
            messages={state.fieldErrors?.category}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" name="city" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Select name="country" defaultValue={DEFAULT_COUNTRY}>
              <SelectTrigger id="country" className="h-11 w-full">
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError
              id="country-error"
              messages={state.fieldErrors?.country}
            />
          </div>
        </div>
      </div>

      <div className={step === 2 ? "space-y-4" : "hidden"}>
        <div className="space-y-2">
          <Label htmlFor="primaryChannel">
            Where do most enquiries arrive?
          </Label>
          <Select name="primaryChannel" defaultValue="whatsapp">
            <SelectTrigger id="primaryChannel" className="h-11 w-full">
              <SelectValue placeholder="Choose a channel" />
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

        <div className="space-y-2">
          <Label htmlFor="whatsappNumber">Business WhatsApp number</Label>
          <Input
            id="whatsappNumber"
            name="whatsappNumber"
            type="tel"
            inputMode="tel"
            placeholder="+91 98765 43210"
            className="h-11"
          />
          <p className="text-sm text-muted-foreground">
            Optional. Used for the enquiry button on your public catalogue.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select name="currency" defaultValue="INR">
            <SelectTrigger id="currency" className="h-11 w-full">
              <SelectValue placeholder="Choose a currency" />
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

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox id="includeDemoData" name="includeDemoData" />
          <div className="space-y-1">
            <Label htmlFor="includeDemoData" className="font-medium">
              Add a few sample records
            </Label>
            <p className="text-sm text-muted-foreground">
              Two sample contacts, a draft product and one follow-up, all named
              &quot;Sample&quot; so you can delete them in seconds.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {step > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setStep((value) => value - 1)}
          >
            <ArrowLeft /> Back
          </Button>
        ) : null}

        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            className="h-11 flex-1"
            onClick={() => setStep((value) => value + 1)}
          >
            Continue <ArrowRight />
          </Button>
        ) : (
          <SubmitButton className="flex-1">Finish setup</SubmitButton>
        )}
      </div>
    </form>
  );
}
