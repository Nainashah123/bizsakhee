"use client";

import { useId, useState } from "react";
import { Loader2, MessageSquareQuote, Sparkles } from "lucide-react";
import Link from "next/link";

import { FieldError, FormAlert } from "@/components/auth/form-parts";
import { CopyField } from "@/components/ai/copy-field";
import type { SelectOption, SmartReplyDraft } from "@/components/ai/options";
import { useAiDraft } from "@/components/ai/use-ai-draft";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Smart Reply.
 *
 * Paste what the customer wrote, get a draft back, copy it, send it yourself.
 * There is deliberately no send button: BizSakhi never messages a customer on
 * the seller's behalf, and a one-click send would make the AI's mistakes hers
 * before she had read them.
 */

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SmartReplyPanel({
  tones,
  languages,
}: {
  tones: SelectOption[];
  languages: SelectOption[];
}) {
  const ids = {
    message: useId(),
    name: useId(),
    context: useId(),
    tone: useId(),
    language: useId(),
  };

  const [customerMessage, setCustomerMessage] = useState("");
  const { state, submit } = useAiDraft<SmartReplyDraft>("/api/ai/reply");

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const optional = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
    };

    void submit({
      customerMessage: customerMessage.trim(),
      contactName: optional("contactName"),
      context: optional("context"),
      tone: form.get("tone"),
      language: form.get("language"),
    });
  };

  const canSubmit = customerMessage.trim().length > 0 && !state.pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareQuote className="size-5 text-primary" aria-hidden="true" />
          Smart reply
        </CardTitle>
        <CardDescription>
          Paste a customer&apos;s message and get a reply you can edit and send
          yourself.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={ids.message}>What did the customer say?</Label>
            <Textarea
              id={ids.message}
              name="customerMessage"
              required
              rows={4}
              maxLength={2000}
              value={customerMessage}
              onChange={(event) => setCustomerMessage(event.target.value)}
              placeholder="Paste their WhatsApp or Instagram message here"
              aria-describedby={`${ids.message}-error`}
              aria-invalid={Boolean(state.fieldErrors.customerMessage)}
            />
            <FieldError
              id={`${ids.message}-error`}
              messages={state.fieldErrors.customerMessage}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.name}>Their name (optional)</Label>
              <Input
                id={ids.name}
                name="contactName"
                maxLength={120}
                className="h-11"
                placeholder="Meera"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.context}>Anything they should know?</Label>
              <Input
                id={ids.context}
                name="context"
                maxLength={500}
                className="h-11"
                placeholder="She ordered last Diwali"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.tone}>Tone</Label>
              <select
                id={ids.tone}
                name="tone"
                defaultValue="friendly"
                className={SELECT_CLASS}
              >
                {tones.map((tone) => (
                  <option key={tone.value} value={tone.value}>
                    {tone.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.language}>Language</Label>
              <select
                id={ids.language}
                name="language"
                defaultValue="en"
                className={SELECT_CLASS}
              >
                {languages.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="h-11 w-full sm:w-auto"
            disabled={!canSubmit}
            aria-busy={state.pending}
          >
            {state.pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            Draft a reply
          </Button>
        </form>

        {state.error ? (
          <div className="space-y-2">
            <FormAlert variant="error">{state.error}</FormAlert>
            {state.upgradeHref ? (
              <Button asChild variant="outline" size="sm">
                <Link href={state.upgradeHref}>See plans</Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        {state.pending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Writing a draft…
          </p>
        ) : null}

        {state.data ? (
          <div className="space-y-4 border-t pt-5">
            <CopyField
              label="Suggested reply"
              value={state.data.reply}
              helper="AI-generated. Read it, change what is wrong, then send it yourself."
              tone="primary"
            />

            {state.data.followUpQuestion ? (
              <CopyField
                label="Follow-up question"
                value={state.data.followUpQuestion}
                helper="Optional - use it if the conversation needs a nudge."
              />
            ) : null}

            <p className="text-xs text-muted-foreground">
              There is no send button on purpose. Copy the draft into WhatsApp
              or Instagram when you are happy with it.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
