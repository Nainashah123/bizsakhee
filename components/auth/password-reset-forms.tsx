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
  forgotPasswordAction,
  resetPasswordAction,
  type AuthState,
} from "@/features/auth/actions";

const EMPTY: AuthState = {};

export function ForgotPasswordForm() {
  const [state, submit] = useActionState(forgotPasswordAction, EMPTY);

  if (state.message) {
    return <FormAlert variant="success">{state.message}</FormAlert>;
  }

  return (
    <form action={submit} className="space-y-4" noValidate>
      <FormAlert variant="error">{state.error}</FormAlert>

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

      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, submit] = useActionState(resetPasswordAction, EMPTY);

  return (
    <form action={submit} className="space-y-4" noValidate>
      <FormAlert variant="error">{state.error}</FormAlert>

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby="password-error"
          className="h-11"
        />
        <FieldError
          id="password-error"
          messages={state.fieldErrors?.password}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby="confirmPassword-error"
          className="h-11"
        />
        <FieldError
          id="confirmPassword-error"
          messages={state.fieldErrors?.confirmPassword}
        />
      </div>

      <SubmitButton>Update password</SubmitButton>
    </form>
  );
}
