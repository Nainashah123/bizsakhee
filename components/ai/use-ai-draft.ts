"use client";

import { useState } from "react";

import type { AiQuotaView } from "@/components/ai/options";

/**
 * The browser half of a draft request.
 *
 * It posts JSON and renders whatever the route says. Every real decision -
 * whether this role may use AI, whether the monthly allowance is left, whether
 * the model's answer fits its schema - is made on the server. Hiding a button
 * is never the check, so a refusal is shown as a message rather than swallowed.
 */

export type AiDraftState<T> = {
  pending: boolean;
  /** A sentence the seller can read. Never a provider or database error. */
  error: string | null;
  fieldErrors: Record<string, string[]>;
  /** Set when the failure was a plan limit, so we can offer the billing link. */
  upgradeHref: string | null;
  data: T | null;
  generationId: string | null;
  quota: AiQuotaView | null;
};

const EMPTY = {
  pending: false,
  error: null,
  fieldErrors: {},
  upgradeHref: null,
  data: null,
  generationId: null,
  quota: null,
} as const;

const NETWORK_ERROR =
  "We could not reach the server. Check your connection and try again.";
const UNEXPECTED =
  "Something went wrong while drafting that. Please try again in a moment.";

function readString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readFieldErrors(
  source: Record<string, unknown>,
): Record<string, string[]> {
  const value = source.fieldErrors;
  if (!value || typeof value !== "object") return {};

  const entries = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, messages]) =>
      Array.isArray(messages)
        ? [
            [
              key,
              messages.filter((m): m is string => typeof m === "string"),
            ] as const,
          ]
        : [],
  );

  return Object.fromEntries(entries);
}

function readQuota(source: Record<string, unknown>): AiQuotaView | null {
  const value = source.quota;
  if (!value || typeof value !== "object") return null;

  const quota = value as Record<string, unknown>;
  if (typeof quota.used !== "number") return null;

  return {
    used: quota.used,
    limit: typeof quota.limit === "number" ? quota.limit : null,
    remaining: typeof quota.remaining === "number" ? quota.remaining : null,
  };
}

export function useAiDraft<T>(endpoint: "/api/ai/reply" | "/api/ai/content") {
  const [state, setState] = useState<AiDraftState<T>>({ ...EMPTY });

  const reset = () => setState({ ...EMPTY });

  const submit = async (body: Record<string, unknown>) => {
    setState({ ...EMPTY, pending: true });

    let payload: Record<string, unknown> = {};
    let okStatus = false;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      okStatus = response.ok;
      const parsed: unknown = await response.json().catch(() => null);
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      setState({ ...EMPTY, error: NETWORK_ERROR });
      return;
    }

    if (!okStatus) {
      setState({
        ...EMPTY,
        error: readString(payload, "message") ?? UNEXPECTED,
        fieldErrors: readFieldErrors(payload),
        upgradeHref: readString(payload, "upgradeHref"),
      });
      return;
    }

    const output = payload.output;
    if (!output || typeof output !== "object") {
      setState({ ...EMPTY, error: UNEXPECTED });
      return;
    }

    setState({
      ...EMPTY,
      data: output as T,
      generationId: readString(payload, "generationId"),
      quota: readQuota(payload),
    });
  };

  return { state, submit, reset };
}
