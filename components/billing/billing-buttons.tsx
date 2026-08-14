"use client";

import { useState } from "react";
import { ArrowUpRight, CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BillingInterval, PlanKey } from "@/lib/plans";

/**
 * The only interactive parts of the billing screen.
 *
 * Both buttons ask the server for a Stripe URL and then hand the browser over.
 * The server route is the authority on whether the caller may do this - hiding
 * a button is never the check - so a refusal is shown as a plain message rather
 * than swallowed.
 */

type BillingEndpoint = "/api/stripe/checkout" | "/api/stripe/portal";

function messageForStatus(status: number, endpoint: BillingEndpoint): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) {
    return "Only the workspace owner can change billing.";
  }
  if (status === 409 && endpoint === "/api/stripe/portal") {
    return "There is no billing account for this workspace yet. Choose a plan first.";
  }
  if (status === 503) {
    return "Payments are not configured on this deployment yet, so there is nothing to open.";
  }
  return "We could not open the payment page. Please try again in a moment.";
}

function stringField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== "object" || !(field in payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function openBillingUrl(
  endpoint: BillingEndpoint,
  body?: Record<string, unknown>,
): Promise<string | null> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // The route already writes a safe, specific message; the status map is
    // only a fallback for a response that carries nothing useful.
    throw new Error(
      stringField(payload, "message") ??
        messageForStatus(response.status, endpoint),
    );
  }

  return stringField(payload, "url");
}

function useBillingRedirect(endpoint: BillingEndpoint) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (body?: Record<string, unknown>) => {
    setError(null);
    setPending(true);
    try {
      const url = await openBillingUrl(endpoint, body);
      if (!url) {
        setError("We could not open the payment page. Please try again.");
        setPending(false);
        return;
      }
      // Leaves the app for Stripe; `pending` stays true until then.
      window.location.assign(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not reach the payment page. Check your connection and try again.",
      );
      setPending(false);
    }
  };

  return { pending, error, start };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function CheckoutButton({
  plan,
  interval,
  label,
  variant = "default",
}: {
  plan: PlanKey;
  interval: BillingInterval;
  label: string;
  variant?: "default" | "outline";
}) {
  const { pending, error, start } = useBillingRedirect("/api/stripe/checkout");

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="lg"
        variant={variant}
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void start({ plan, interval })}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUpRight aria-hidden="true" />
        )}
        {label}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

export function ManageBillingButton({
  label = "Manage billing",
  variant = "outline",
}: {
  label?: string;
  variant?: "default" | "outline";
}) {
  const { pending, error, start } = useBillingRedirect("/api/stripe/portal");

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="lg"
        variant={variant}
        disabled={pending}
        aria-busy={pending}
        onClick={() => void start()}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard aria-hidden="true" />
        )}
        {label}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}
