"use client";

import { useActionState } from "react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createProductAction,
  updateProductAction,
  type ProductActionState,
} from "@/features/products/actions";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  STOCK_STATUSES,
  STOCK_STATUS_LABELS,
} from "@/lib/validation/products";

const EMPTY: ProductActionState = {};

export type ProductFormDefaults = {
  productId?: string;
  name: string;
  slug: string;
  description: string;
  sku: string;
  /** Major units, already formatted for the input (e.g. "1249.50"). */
  price: string;
  salePrice: string;
  stockStatus: string;
  stockQuantity: string;
  status: string;
};

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Product details form.
 *
 * Prices are typed in major units and converted server-side with
 * `toMinorUnits`, so the browser never decides how an amount is scaled. The
 * currency is fixed by the workspace and shown as a read-only hint.
 */
export function ProductForm({
  mode,
  defaults,
  currency,
}: {
  mode: "create" | "edit";
  defaults: ProductFormDefaults;
  currency: string;
}) {
  const [state, submit] = useActionState(
    mode === "create" ? createProductAction : updateProductAction,
    EMPTY,
  );

  return (
    <form action={submit} className="space-y-5" noValidate>
      {mode === "edit" && defaults.productId ? (
        <input type="hidden" name="productId" value={defaults.productId} />
      ) : null}

      <FormAlert variant="error">{state.error}</FormAlert>
      <FormAlert variant="success">{state.message}</FormAlert>

      <div className="space-y-2">
        <Label htmlFor="name">Product name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={160}
          defaultValue={defaults.name}
          className="h-11"
          aria-describedby="name-error"
        />
        <FieldError id="name-error" messages={state.fieldErrors?.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={defaults.description}
          placeholder="What it is, what it is made of, how long it takes."
          aria-describedby="description-error"
        />
        <FieldError
          id="description-error"
          messages={state.fieldErrors?.description}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sku">SKU / your own code</Label>
          <Input
            id="sku"
            name="sku"
            maxLength={64}
            defaultValue={defaults.sku}
            className="h-11"
            aria-describedby="sku-error"
          />
          <FieldError id="sku-error" messages={state.fieldErrors?.sku} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">Catalogue link</Label>
          <Input
            id="slug"
            name="slug"
            maxLength={80}
            defaultValue={defaults.slug}
            placeholder="Left blank, we build one from the name"
            className="h-11 font-mono"
            aria-describedby="slug-hint slug-error"
          />
          <p id="slug-hint" className="text-xs text-muted-foreground">
            Lowercase letters, numbers and hyphens. A number is added if the
            link is already used.
          </p>
          <FieldError id="slug-error" messages={state.fieldErrors?.slug} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="price">Price ({currency})</Label>
          <Input
            id="price"
            name="price"
            required
            inputMode="decimal"
            defaultValue={defaults.price}
            placeholder="1249.50"
            className="h-11"
            aria-describedby="price-error"
          />
          <FieldError id="price-error" messages={state.fieldErrors?.price} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="salePrice">Sale price ({currency})</Label>
          <Input
            id="salePrice"
            name="salePrice"
            inputMode="decimal"
            defaultValue={defaults.salePrice}
            placeholder="Optional"
            className="h-11"
            aria-describedby="salePrice-hint salePrice-error"
          />
          <p id="salePrice-hint" className="text-xs text-muted-foreground">
            Must be the same as, or lower than, the price.
          </p>
          <FieldError
            id="salePrice-error"
            messages={state.fieldErrors?.salePrice}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="stockStatus">Availability</Label>
          <select
            id="stockStatus"
            name="stockStatus"
            defaultValue={defaults.stockStatus}
            className={selectClass}
          >
            {STOCK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STOCK_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <FieldError
            id="stockStatus-error"
            messages={state.fieldErrors?.stockStatus}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="stockQuantity">Quantity on hand</Label>
          <Input
            id="stockQuantity"
            name="stockQuantity"
            inputMode="numeric"
            defaultValue={defaults.stockQuantity}
            placeholder="Optional"
            className="h-11"
            aria-describedby="stockQuantity-error"
          />
          <FieldError
            id="stockQuantity-error"
            messages={state.fieldErrors?.stockQuantity}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={defaults.status}
            className={selectClass}
          >
            {PRODUCT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PRODUCT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <FieldError id="status-error" messages={state.fieldErrors?.status} />
        </div>
      </div>

      <SubmitButton className="sm:w-auto sm:min-w-44">
        {mode === "create" ? "Create product" : "Save changes"}
      </SubmitButton>
    </form>
  );
}
