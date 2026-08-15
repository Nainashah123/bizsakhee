"use client";

import { useActionState } from "react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { PasswordInput } from "@/components/auth/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction, type AuthState } from "@/features/auth/actions";

const EMPTY: AuthState = {};

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const [state, submit] = useActionState(signUpAction, EMPTY);

  if (state.message) {
    return <FormAlert variant="success">{state.message}</FormAlert>;
  }

  return (
    <form action={submit} className="space-y-4" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <FormAlert variant="error">{state.error}</FormAlert>

      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          aria-describedby="fullName-error"
          className="h-11"
        />
        <FieldError
          id="fullName-error"
          messages={state.fieldErrors?.fullName}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          aria-describedby="email-error"
          className="h-11"
        />
        <FieldError id="email-error" messages={state.fieldErrors?.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby="password-hint password-error"
        />
        <p id="password-hint" className="text-sm text-muted-foreground">
          At least 10 characters. A short phrase you will remember works well.
        </p>
        <FieldError
          id="password-error"
          messages={state.fieldErrors?.password}
        />
      </div>

      <SubmitButton>Create my workspace</SubmitButton>
    </form>
  );
}
