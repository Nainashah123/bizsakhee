import type { Metadata } from "next";
import Link from "next/link";

import { SignUpForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirect } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "Start free",
  description: "Create your free BizSakhi workspace.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectParam = Array.isArray(params.redirectTo)
    ? params.redirectTo[0]
    : params.redirectTo;

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild className="text-2xl">
          <h1>Start free</h1>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          One workspace for your customers, orders and follow-ups. No card
          needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <SignUpForm redirectTo={safeRedirect(redirectParam, "/onboarding")} />

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
