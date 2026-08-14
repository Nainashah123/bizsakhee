import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirect } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your BizSakhi workspace.",
};

export default async function LoginPage({
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
          <h1>Welcome back</h1>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Sign in to pick up where you left off.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <LoginForm
          redirectTo={safeRedirect(redirectParam)}
          linkError={params.error === "link_invalid"}
        />

        <p className="text-center text-sm text-muted-foreground">
          New to BizSakhi?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create a free workspace
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
