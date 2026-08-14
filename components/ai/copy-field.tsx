"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared result UI for both AI tools.
 *
 * Every generated field is shown as read-only text with a copy button beside
 * it. Copying is the only action: the seller pastes the draft into WhatsApp or
 * Instagram herself, after reading it. Nothing here can send anything.
 */

const RESET_MS = 2_000;

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      // Only available over HTTPS or on localhost; the failure is shown rather
      // than swallowed, so the seller knows to select the text instead.
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("shrink-0", className)}
      onClick={() => void copy()}
    >
      {state === "copied" ? (
        <Check className="text-success" aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      <span>
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Select it"
            : "Copy"}
      </span>
      <span className="sr-only">
        {state === "copied"
          ? ` ${label} copied to clipboard`
          : state === "failed"
            ? ` ${label} could not be copied, please select the text`
            : ` ${label}`}
      </span>
    </Button>
  );
}

export function CopyField({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper?: string;
  /** `primary` gives the main draft a little more visual weight. */
  tone?: "default" | "primary";
}) {
  const id = useId();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={id} className="text-sm font-medium">
            {label}
          </p>
          {helper ? (
            <p className="text-xs text-muted-foreground">{helper}</p>
          ) : null}
        </div>
        <CopyButton value={value} label={label} />
      </div>

      <p
        aria-labelledby={id}
        tabIndex={0}
        className={cn(
          "rounded-lg border px-3 py-2.5 text-sm whitespace-pre-wrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          tone === "primary" ? "border-primary/30 bg-primary/5" : "bg-muted/40",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function HashtagField({ hashtags }: { hashtags: string[] }) {
  const id = useId();
  const joined = hashtags.join(" ");

  if (hashtags.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Hashtags</p>
        <p className="text-sm text-muted-foreground">
          None suggested for this one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <p id={id} className="text-sm font-medium">
          Hashtags
        </p>
        <CopyButton value={joined} label="Hashtags" />
      </div>
      <ul aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {hashtags.map((hashtag) => (
          <li
            key={hashtag}
            className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
          >
            {hashtag}
          </li>
        ))}
      </ul>
    </div>
  );
}
