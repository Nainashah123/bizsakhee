import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SupabaseSetupRequired } from "@/components/setup/setup-required";
import { getSessionContext } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Set up your workspace",
};

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) return <SupabaseSetupRequired />;

  const context = await getSessionContext();
  if (!context) redirect("/login");
  if (context.workspace) redirect("/dashboard");

  const defaultName =
    (context.user.user_metadata?.full_name as string | undefined) ?? "";

  return (
    <div className="min-h-full bg-gradient-to-b from-secondary/60 to-background">
      <div className="mx-auto w-full max-w-xl px-4 py-10">
        <Logo className="mb-8" />

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Let&apos;s set you up</CardTitle>
            <p className="text-sm text-muted-foreground">
              Three short steps. You can change any of this later in settings.
            </p>
          </CardHeader>
          <CardContent>
            <OnboardingForm defaultName={defaultName} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
