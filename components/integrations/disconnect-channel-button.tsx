"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Unplug } from "lucide-react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  disconnectChannelAction,
  type ChannelActionState,
} from "@/features/integrations/actions";
import {
  CHANNEL_LABELS,
  type ChannelProvider,
} from "@/features/integrations/status";

/**
 * Turns a channel off.
 *
 * A plain form posting to a Server Action, so it still works before hydration.
 * The action re-checks `integrations.manage` server-side; this component only
 * decides what is on screen.
 */

const EMPTY: ChannelActionState = {};

function DisconnectSubmit({ provider }: { provider: ChannelProvider }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      className="w-full sm:w-auto"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Unplug aria-hidden="true" />
      )}
      Disconnect
      <span className="sr-only"> {CHANNEL_LABELS[provider]}</span>
    </Button>
  );
}

export function DisconnectChannelButton({
  provider,
}: {
  provider: ChannelProvider;
}) {
  const [state, action] = useActionState(disconnectChannelAction, EMPTY);

  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="provider" value={provider} />
      <DisconnectSubmit provider={provider} />

      {state.status === "error" ? (
        <FormAlert variant="error">{state.message}</FormAlert>
      ) : null}
      {state.status === "done" ? (
        <FormAlert variant="success">{state.message}</FormAlert>
      ) : null}
    </form>
  );
}
