import { CircleAlert, ExternalLink } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type SetupStep = {
  label: string;
  detail: string;
  done: boolean;
};

/**
 * Honest configuration state.
 *
 * Shown wherever a feature genuinely cannot work because a credential is
 * missing. It never claims something is connected, and it names the exact
 * variables to set rather than hiding the cause behind a generic error.
 */
export function SetupRequired({
  title,
  summary,
  steps,
  docsPath = "docs/deployment.md",
}: {
  title: string;
  summary: string;
  steps: SetupStep[];
  docsPath?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <Logo className="mb-8" />

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning-foreground">
              <CircleAlert className="size-5" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <CardTitle>{title}</CardTitle>
              <p className="text-sm text-muted-foreground">{summary}</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.label} className="flex gap-3">
                <span
                  className={
                    step.done
                      ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-success/20 text-xs font-semibold text-success-foreground"
                      : "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                  }
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {step.label}
                    <span className="sr-only">
                      {step.done ? " (done)" : " (not done)"}
                    </span>
                  </p>
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="flex items-center gap-1.5 border-t pt-4 text-sm text-muted-foreground">
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Full instructions: <code className="font-mono">{docsPath}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** The Supabase-specific variant, used by the auth and dashboard shells. */
export function SupabaseSetupRequired() {
  return (
    <SetupRequired
      title="Setup required: connect a Supabase project"
      summary="Accounts, sign-in and every piece of your data live in Supabase. Until a project is connected there is nothing to sign in to - this is a configuration state, not an error."
      steps={[
        {
          label: "Create a Supabase project",
          detail: "supabase.com/dashboard - free tier is enough to start",
          done: false,
        },
        {
          label: "Copy .env.example to .env.local",
          detail: "cp .env.example .env.local",
          done: false,
        },
        {
          label: "Fill in the project URL and publishable key",
          detail:
            "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY",
          done: false,
        },
        {
          label: "Apply the database migrations",
          detail: "pnpm exec supabase link, then pnpm exec supabase db push",
          done: false,
        },
        {
          label: "Restart the dev server",
          detail: "pnpm dev",
          done: false,
        },
      ]}
    />
  );
}
