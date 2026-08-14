"use client";

import { useActionState } from "react";
import { Archive, ArchiveRestore, Globe, PencilLine } from "lucide-react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  setProductStatusAction,
  type ProductActionState,
} from "@/features/products/actions";
import type { ProductStatusValue } from "@/lib/validation/products";

const EMPTY: ProductActionState = {};

/**
 * Publish / unpublish / archive.
 *
 * Only the transitions that make sense from the current status are offered, so
 * there is never a button that would be a no-op.
 */
export function ProductStatusActions({
  productId,
  status,
}: {
  productId: string;
  status: ProductStatusValue;
}) {
  const [state, submit] = useActionState(setProductStatusAction, EMPTY);

  return (
    <div className="space-y-2">
      <FormAlert variant="error">{state.error}</FormAlert>
      <FormAlert variant="success">{state.message}</FormAlert>

      <form action={submit} className="flex flex-wrap gap-2">
        <input type="hidden" name="productId" value={productId} />

        {status !== "published" ? (
          <Button type="submit" name="status" value="published" size="lg">
            <Globe aria-hidden="true" />
            Publish
          </Button>
        ) : null}

        {status === "published" ? (
          <Button
            type="submit"
            name="status"
            value="draft"
            variant="secondary"
            size="lg"
          >
            <PencilLine aria-hidden="true" />
            Move to draft
          </Button>
        ) : null}

        {status !== "archived" ? (
          <Button
            type="submit"
            name="status"
            value="archived"
            variant="destructive"
            size="lg"
          >
            <Archive aria-hidden="true" />
            Archive
          </Button>
        ) : (
          <Button
            type="submit"
            name="status"
            value="draft"
            variant="secondary"
            size="lg"
          >
            <ArchiveRestore aria-hidden="true" />
            Restore as draft
          </Button>
        )}
      </form>
    </div>
  );
}
