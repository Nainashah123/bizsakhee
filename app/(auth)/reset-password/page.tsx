import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Set a new password",
};

/**
 * Reached from the recovery email, which has already established a session via
 * /auth/callback. Without that session there is nothing to update, so we say so
 * rather than showing a form that cannot work.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Set a new password</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose a password you have not used elsewhere.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {user ? (
          <ResetPasswordForm />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This reset link is no longer valid. Reset links expire for your
              security - request a fresh one and it will work straight away.
            </p>
            <Link
              href="/forgot-password"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Request a new reset link
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
