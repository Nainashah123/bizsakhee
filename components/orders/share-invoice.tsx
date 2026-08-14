"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, Link2Off, RefreshCw } from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateInvoiceLinkAction,
  revokeInvoiceLinkAction,
  type OrderActionState,
} from "@/features/orders/actions";

const EMPTY_STATE: OrderActionState = {};

/**
 * Owner-side control of the public invoice link.
 *
 * Only a SHA-256 hash of the token is stored, so the URL can be shown exactly
 * once - when it is created. Losing it means issuing a new one, which replaces
 * the old link immediately.
 */
export function ShareInvoicePanel({
  orderId,
  hasShareLink,
}: {
  orderId: string;
  hasShareLink: boolean;
}) {
  const fieldId = useId();
  const [generateState, generate] = useActionState(
    generateInvoiceLinkAction,
    EMPTY_STATE,
  );
  const [revokeState, revoke] = useActionState(
    revokeInvoiceLinkAction,
    EMPTY_STATE,
  );
  const [copied, setCopied] = useState(false);

  const shareUrl = generateState.shareUrl;

  useEffect(() => {
    if (revokeState.message) toast.success(revokeState.message);
  }, [revokeState.message]);

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copying failed. Select the link and copy it by hand.");
    }
  };

  return (
    <div className="space-y-3">
      <FormAlert variant="error">
        {generateState.error ?? revokeState.error}
      </FormAlert>

      {shareUrl ? (
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-url`}>Shareable invoice link</Label>
          <div className="flex gap-2">
            <Input
              id={`${fieldId}-url`}
              className="h-11 font-mono text-xs"
              value={shareUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={copy}
              aria-label="Copy invoice link"
            >
              <Copy aria-hidden="true" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            Copy it now - for safety this is the only time the link is shown.
            Anyone with it can view this invoice, and nothing else.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hasShareLink
            ? "A share link is active for this invoice. The link itself is stored only as a hash, so it cannot be shown again - create a new one if you need it, which replaces the old link."
            : "Create a link you can send on WhatsApp. It opens a read-only invoice and shows nothing else from your workspace."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={generate}>
          <input type="hidden" name="orderId" value={orderId} />
          <SubmitButton variant="outline" className="sm:w-auto">
            {hasShareLink ? (
              <RefreshCw aria-hidden="true" />
            ) : (
              <Link2 aria-hidden="true" />
            )}
            {hasShareLink ? "Create a new link" : "Create share link"}
          </SubmitButton>
        </form>

        {hasShareLink ? (
          <form action={revoke}>
            <input type="hidden" name="orderId" value={orderId} />
            <SubmitButton variant="ghost" className="sm:w-auto">
              <Link2Off aria-hidden="true" />
              Revoke link
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
