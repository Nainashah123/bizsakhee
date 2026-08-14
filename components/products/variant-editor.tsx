"use client";

import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteVariantAction,
  saveVariantAction,
  type ProductActionState,
} from "@/features/products/actions";

const EMPTY: ProductActionState = {};

export type VariantDefaults = {
  id: string;
  name: string;
  sku: string;
  /** Major units, formatted for the input. Empty means "use the product price". */
  price: string;
  stockQuantity: string;
  position: number;
};

/**
 * Variants (sizes, colours, weights).
 *
 * Each row is its own form so a failed save only reports against that row, and
 * so the whole editor keeps working without JavaScript.
 */
export function VariantEditor({
  productId,
  variants,
  currency,
}: {
  productId: string;
  variants: VariantDefaults[];
  currency: string;
}) {
  return (
    <div className="space-y-4">
      {variants.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No options yet. Add one if this product comes in different sizes,
          colours or weights - each option can carry its own price and stock.
        </p>
      ) : (
        <ul className="space-y-4">
          {variants.map((variant) => (
            <li key={variant.id}>
              <VariantRow
                productId={productId}
                variant={variant}
                currency={currency}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="border-t pt-4">
        <VariantRow
          productId={productId}
          currency={currency}
          nextPosition={variants.length}
        />
      </div>
    </div>
  );
}

function VariantRow({
  productId,
  variant,
  currency,
  nextPosition,
}: {
  productId: string;
  variant?: VariantDefaults;
  currency: string;
  nextPosition?: number;
}) {
  const [state, submit] = useActionState(saveVariantAction, EMPTY);
  const [deleteState, remove] = useActionState(deleteVariantAction, EMPTY);
  const isNew = !variant;
  const idPrefix = variant ? `variant-${variant.id}` : "variant-new";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <FormAlert variant="error">{state.error ?? deleteState.error}</FormAlert>
      <FormAlert variant="success">
        {state.message ?? deleteState.message}
      </FormAlert>

      <form action={submit} className="space-y-3" noValidate>
        <input type="hidden" name="productId" value={productId} />
        {variant ? (
          <input type="hidden" name="variantId" value={variant.id} />
        ) : null}
        <input
          type="hidden"
          name="position"
          value={variant?.position ?? nextPosition ?? 0}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor={`${idPrefix}-name`}>Option name</Label>
            <Input
              id={`${idPrefix}-name`}
              name="name"
              required
              maxLength={120}
              defaultValue={variant?.name ?? ""}
              placeholder="Large / Red / 500g"
              className="h-11"
              aria-describedby={`${idPrefix}-name-error`}
            />
            <FieldError
              id={`${idPrefix}-name-error`}
              messages={state.fieldErrors?.name}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-sku`}>SKU</Label>
            <Input
              id={`${idPrefix}-sku`}
              name="sku"
              maxLength={64}
              defaultValue={variant?.sku ?? ""}
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-price`}>Price ({currency})</Label>
            <Input
              id={`${idPrefix}-price`}
              name="price"
              inputMode="decimal"
              defaultValue={variant?.price ?? ""}
              placeholder="Same as product"
              className="h-11"
              aria-describedby={`${idPrefix}-price-error`}
            />
            <FieldError
              id={`${idPrefix}-price-error`}
              messages={state.fieldErrors?.price}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-stock`}>Quantity</Label>
            <Input
              id={`${idPrefix}-stock`}
              name="stockQuantity"
              inputMode="numeric"
              defaultValue={variant?.stockQuantity ?? ""}
              placeholder="Optional"
              className="h-11"
              aria-describedby={`${idPrefix}-stock-error`}
            />
            <FieldError
              id={`${idPrefix}-stock-error`}
              messages={state.fieldErrors?.stockQuantity}
            />
          </div>
        </div>

        <SubmitButton className="sm:w-auto sm:min-w-36" variant="secondary">
          {isNew ? (
            <>
              <Plus aria-hidden="true" />
              Add option
            </>
          ) : (
            "Save option"
          )}
        </SubmitButton>
      </form>

      {variant ? (
        <form action={remove}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="variantId" value={variant.id} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 aria-hidden="true" />
            Remove {variant.name}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
