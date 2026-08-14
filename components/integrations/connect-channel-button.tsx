"use client";

import { useState } from "react";
import { Loader2, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CHANNEL_LABELS,
  type ChannelProvider,
} from "@/features/integrations/status";

/**
 * Starts the Meta OAuth round trip.
 *
 * The route is the authority on whether this is allowed and whether it is even
 * possible - the button is only ever a request. A refusal is shown verbatim
 * from the route when it sends one, because "Channels are not configured on
 * this deployment" is far more useful than "something went wrong".
 */

const START_ENDPOINT = "/api/meta/oauth/start";

function fallbackMessage(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) {
    return "Only a workspace owner or admin can connect a channel.";
  }
  if (status === 404) {
    return "Connecting is not available on this deployment yet.";
  }
  if (status === 503) {
    return "Meta is not configured on this deployment, so there is nothing to connect to yet.";
  }
  return "We could not start the connection. Please try again in a moment.";
}

function stringField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== "object" || !(field in payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function ConnectChannelButton({
  provider,
  label,
  variant = "default",
  disabled = false,
}: {
  provider: ChannelProvider;
  label?: string;
  variant?: "default" | "outline";
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setPending(true);

    try {
      const response = await fetch(START_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          stringField(payload, "message") ?? fallbackMessage(response.status),
        );
        setPending(false);
        return;
      }

      const url = stringField(payload, "url");
      if (!url) {
        setError(
          "The connection could not be started. Please try again in a moment.",
        );
        setPending(false);
        return;
      }

      // Leaves the app for Meta; `pending` stays true until the browser moves.
      window.location.assign(url);
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
      setPending(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant={variant}
        className="w-full sm:w-auto"
        disabled={pending || disabled}
        aria-busy={pending}
        onClick={() => void start()}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Plug aria-hidden="true" />
        )}
        {label ?? `Connect ${CHANNEL_LABELS[provider]}`}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
