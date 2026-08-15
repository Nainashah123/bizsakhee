"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { PasswordInput } from "@/components/auth/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  magicLinkAction,
  signInAction,
  type AuthState,
} from "@/features/auth/actions";

const EMPTY: AuthState = {};

export function LoginForm({
  redirectTo,
  linkError,
}: {
  redirectTo: string;
  linkError?: boolean;
}) {
  const [passwordState, passwordSubmit] = useActionState(signInAction, EMPTY);
  const [magicState, magicSubmit] = useActionState(magicLinkAction, EMPTY);
  const [email, setEmail] = useState("");

  return (
    <Tabs defaultValue="password" className="gap-6">
      <TabsList className="w-full">
        <TabsTrigger value="password" className="flex-1">
          Password
        </TabsTrigger>
        <TabsTrigger value="magic" className="flex-1">
          Email link
        </TabsTrigger>
      </TabsList>

      {linkError ? (
        <FormAlert variant="error">
          That link is invalid or has expired. Request a new one below.
        </FormAlert>
      ) : null}

      <TabsContent value="password">
        <form action={passwordSubmit} className="space-y-4" noValidate>
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <FormAlert variant="error">{passwordState.error}</FormAlert>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby="email-error"
              className="h-11"
            />
            <FieldError
              id="email-error"
              messages={passwordState.fieldErrors?.email}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              aria-describedby="password-error"
            />
            <FieldError
              id="password-error"
              messages={passwordState.fieldErrors?.password}
            />
          </div>

          <SubmitButton>Sign in</SubmitButton>
        </form>
      </TabsContent>

      <TabsContent value="magic">
        <form action={magicSubmit} className="space-y-4" noValidate>
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <FormAlert variant="error">{magicState.error}</FormAlert>
          <FormAlert variant="success">{magicState.message}</FormAlert>

          <div className="space-y-2">
            <Label htmlFor="magic-email">Email</Label>
            <Input
              id="magic-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              defaultValue={email}
              aria-describedby="magic-email-error"
              className="h-11"
            />
            <FieldError
              id="magic-email-error"
              messages={magicState.fieldErrors?.email}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            We will email you a link that signs you in - no password needed.
          </p>

          <SubmitButton>Email me a link</SubmitButton>
        </form>
      </TabsContent>
    </Tabs>
  );
}
