"use client";

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronsUpDown, Plus, Trash2 } from "lucide-react";

import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/auth/form-parts";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createOrderAction,
  updateOrderAction,
  type OrderActionState,
} from "@/features/orders/actions";
import type { ContactOption, ProductOption } from "@/features/orders/queries";
import {
  formatMoney,
  toMajorUnits,
  toMinorUnits,
  type CurrencyCode,
} from "@/lib/money";
import { computeOrderTotals } from "@/lib/orders/totals";
import { cn } from "@/lib/utils";
import {
  ORDER_STATUS_LABELS,
  TAX_RATE_OPTIONS,
  type OrderStatusValue,
} from "@/lib/validation/orders";

/**
 * The order editor.
 *
 * The totals shown here are a *preview*: they run the same pure
 * `computeOrderTotals` the server runs, but the server recomputes everything
 * from its own product prices before writing, and only the item rows - never a
 * total - are submitted.
 */

const EMPTY_STATE: OrderActionState = {};

/** Statuses a person can set from the editor. Cancelling has its own action. */
const EDITABLE_STATUSES = (
  ["draft", "confirmed", "in_progress", "ready", "fulfilled"] as const
).map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));

export type LineDraft = {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
};

export type OrderFormDefaults = {
  orderId?: string;
  contactId: string;
  status: OrderStatusValue;
  lines: LineDraft[];
  discountType: "amount" | "percent";
  discountValue: string;
  taxBasisPoints: number;
  shipping: string;
  notes: string;
  dueOn: string;
};

let lineCounter = 0;
function newLine(partial: Partial<LineDraft> = {}): LineDraft {
  lineCounter += 1;
  return {
    key: `line-${lineCounter}`,
    productId: null,
    description: "",
    quantity: "1",
    unitPrice: "",
    ...partial,
  };
}

export function emptyOrderDefaults(): OrderFormDefaults {
  return {
    contactId: "",
    status: "draft",
    lines: [newLine()],
    discountType: "amount",
    discountValue: "",
    taxBasisPoints: 0,
    shipping: "",
    notes: "",
    dueOn: "",
  };
}

/** Major-unit text -> minor units, or null when the text is not a number. */
function safeMinor(value: string, currency: CurrencyCode): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  try {
    const minor = toMinorUnits(trimmed, currency);
    return minor >= 0 && Number.isSafeInteger(minor) ? minor : null;
  } catch {
    return null;
  }
}

function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  describedBy,
}: {
  id: string;
  value: string | null;
  onChange: (value: string) => void;
  options: { value: string; label: string; hint?: string | null }[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="lg"
          role="combobox"
          aria-expanded={open}
          aria-describedby={describedBy}
          className="h-11 w-full justify-between font-normal"
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint ?? ""}`}
                  data-checked={option.value === value}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function OrderForm({
  mode,
  contacts,
  products,
  currency,
  defaults,
  onSaved,
}: {
  mode: "create" | "edit";
  contacts: ContactOption[];
  products: ProductOption[];
  currency: CurrencyCode;
  defaults: OrderFormDefaults;
  onSaved: () => void;
}) {
  const [state, submit] = useActionState(
    mode === "create" ? createOrderAction : updateOrderAction,
    EMPTY_STATE,
  );

  const fieldId = useId();
  const [contactId, setContactId] = useState(defaults.contactId);
  const [lines, setLines] = useState<LineDraft[]>(defaults.lines);
  const [discountType, setDiscountType] = useState(defaults.discountType);
  const [discountValue, setDiscountValue] = useState(defaults.discountValue);
  const [taxBasisPoints, setTaxBasisPoints] = useState(defaults.taxBasisPoints);
  const [shipping, setShipping] = useState(defaults.shipping);

  useEffect(() => {
    if (state.message) {
      toast.success(state.message);
      onSaved();
    }
  }, [state.message, onSaved]);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const preview = useMemo(() => {
    try {
      const parsedLines = lines.map((line) => {
        const unitPriceMinor = safeMinor(line.unitPrice, currency);
        const quantity = Number(line.quantity);
        if (unitPriceMinor === null || !Number.isFinite(quantity)) {
          throw new Error("unparseable");
        }
        return {
          description: line.description,
          quantity,
          unitPriceMinor,
          productId: line.productId,
        };
      });

      const discount = safeMinor(discountValue, currency);
      const shippingMinor = safeMinor(shipping, currency);
      if (discount === null || shippingMinor === null) {
        throw new Error("unparseable");
      }

      return computeOrderTotals({
        lines: parsedLines,
        discountMinor: discountType === "amount" ? discount : 0,
        discountBasisPoints: discountType === "percent" ? discount : 0,
        taxBasisPoints,
        shippingMinor,
      });
    } catch {
      return null;
    }
  }, [lines, discountType, discountValue, taxBasisPoints, shipping, currency]);

  const itemsPayload = JSON.stringify(
    lines.map((line) => ({
      productId: line.productId ?? "",
      description: line.description.trim(),
      quantity: Number(line.quantity) || 0,
      unitPrice: line.unitPrice.trim() === "" ? "0" : line.unitPrice.trim(),
    })),
  );

  const itemFieldErrors = Object.entries(state.fieldErrors ?? {})
    .filter(([key]) => key.startsWith("items"))
    .flatMap(([, messages]) => messages);

  const money = (minor: number) => formatMoney(minor, currency);

  return (
    <form action={submit} className="space-y-5" noValidate>
      {defaults.orderId ? (
        <input type="hidden" name="orderId" value={defaults.orderId} />
      ) : null}
      <input type="hidden" name="items" value={itemsPayload} />
      <input type="hidden" name="contactId" value={contactId} />

      <FormAlert variant="error">{state.error}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-contact`}>Customer</Label>
          {contacts.length > 0 ? (
            <Combobox
              id={`${fieldId}-contact`}
              value={contactId || null}
              onChange={setContactId}
              options={contacts.map((contact) => ({
                value: contact.id,
                label: contact.label,
                hint: contact.hint,
              }))}
              placeholder="Choose a customer"
              searchPlaceholder="Search customers"
              emptyText="No customer matches that."
              describedBy={`${fieldId}-contact-error`}
            />
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              Add a customer first - an order always belongs to someone.
            </p>
          )}
          <FieldError
            id={`${fieldId}-contact-error`}
            messages={state.fieldErrors?.contactId}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-status`}>Status</Label>
          <Select name="status" defaultValue={defaults.status}>
            <SelectTrigger id={`${fieldId}-status`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Items</legend>

        <ul className="space-y-3">
          {lines.map((line, index) => {
            const product = line.productId
              ? productById.get(line.productId)
              : undefined;
            return (
              <li
                key={line.key}
                className="space-y-3 rounded-xl border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Item {index + 1}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setLines((current) =>
                        current.length === 1
                          ? current
                          : current.filter((item) => item.key !== line.key),
                      )
                    }
                    disabled={lines.length === 1}
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${fieldId}-product-${line.key}`}>
                    Product
                  </Label>
                  <Combobox
                    id={`${fieldId}-product-${line.key}`}
                    value={line.productId ?? "custom"}
                    onChange={(value) => {
                      if (value === "custom") {
                        updateLine(line.key, {
                          productId: null,
                          description: "",
                          unitPrice: "",
                        });
                        return;
                      }
                      const picked = productById.get(value);
                      updateLine(line.key, {
                        productId: value,
                        description: picked?.name ?? "",
                        unitPrice: picked
                          ? String(toMajorUnits(picked.priceMinor, currency))
                          : "",
                      });
                    }}
                    options={[
                      { value: "custom", label: "Custom line (type it in)" },
                      ...products.map((product) => ({
                        value: product.id,
                        label: product.name,
                        hint: money(product.priceMinor),
                      })),
                    ]}
                    placeholder="Custom line (type it in)"
                    searchPlaceholder="Search products"
                    emptyText="No product matches that."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${fieldId}-desc-${line.key}`}>
                    Description
                  </Label>
                  <Input
                    id={`${fieldId}-desc-${line.key}`}
                    className="h-11"
                    value={line.description}
                    readOnly={Boolean(product)}
                    placeholder="What are you selling?"
                    onChange={(event) =>
                      updateLine(line.key, { description: event.target.value })
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldId}-qty-${line.key}`}>
                      Quantity
                    </Label>
                    <Input
                      id={`${fieldId}-qty-${line.key}`}
                      className="h-11"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, { quantity: event.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`${fieldId}-price-${line.key}`}>
                      Unit price
                    </Label>
                    <Input
                      id={`${fieldId}-price-${line.key}`}
                      className="h-11"
                      inputMode="decimal"
                      value={line.unitPrice}
                      readOnly={Boolean(product)}
                      placeholder="0.00"
                      onChange={(event) =>
                        updateLine(line.key, { unitPrice: event.target.value })
                      }
                    />
                  </div>
                </div>

                {product ? (
                  <p className="text-xs text-muted-foreground">
                    Name and price come from your catalogue. Use a custom line
                    to charge something different.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setLines((current) => [...current, newLine()])}
        >
          <Plus aria-hidden="true" />
          Add another item
        </Button>

        {itemFieldErrors.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {itemFieldErrors[0]}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-discount`}>Discount</Label>
          <div className="flex gap-2">
            <Input
              id={`${fieldId}-discount`}
              name="discountValue"
              className="h-11"
              inputMode="decimal"
              placeholder="0"
              value={discountValue}
              onChange={(event) => setDiscountValue(event.target.value)}
              aria-describedby={`${fieldId}-discount-error`}
            />
            <Select
              name="discountType"
              value={discountType}
              onValueChange={(value) =>
                setDiscountType(value as "amount" | "percent")
              }
            >
              <SelectTrigger className="h-11 w-32" aria-label="Discount type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amount">{currency}</SelectItem>
                <SelectItem value="percent">%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FieldError
            id={`${fieldId}-discount-error`}
            messages={state.fieldErrors?.discountValue}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-tax`}>Tax</Label>
          <Select
            name="taxBasisPoints"
            value={String(taxBasisPoints)}
            onValueChange={(value) => setTaxBasisPoints(Number(value))}
          >
            <SelectTrigger id={`${fieldId}-tax`} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAX_RATE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-shipping`}>Delivery charges</Label>
          <Input
            id={`${fieldId}-shipping`}
            name="shipping"
            className="h-11"
            inputMode="decimal"
            placeholder="0"
            value={shipping}
            onChange={(event) => setShipping(event.target.value)}
            aria-describedby={`${fieldId}-shipping-error`}
          />
          <FieldError
            id={`${fieldId}-shipping-error`}
            messages={state.fieldErrors?.shipping}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-due`}>Payment due on</Label>
          <Input
            id={`${fieldId}-due`}
            name="dueOn"
            type="date"
            className="h-11"
            defaultValue={defaults.dueOn}
            aria-describedby={`${fieldId}-due-error`}
          />
          <FieldError
            id={`${fieldId}-due-error`}
            messages={state.fieldErrors?.dueOn}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-notes`}>Notes</Label>
        <Textarea
          id={`${fieldId}-notes`}
          name="notes"
          rows={3}
          defaultValue={defaults.notes}
          placeholder="Anything the customer should see on the invoice."
        />
      </div>

      <div
        className="rounded-xl border bg-muted/40 p-4"
        aria-live="polite"
        aria-atomic="true"
      >
        <h3 className="text-sm font-semibold">Preview</h3>
        {preview ? (
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{money(preview.subtotalMinor)}</dd>
            </div>
            {preview.discountMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums">
                  - {money(preview.discountMinor)}
                </dd>
              </div>
            ) : null}
            {preview.taxMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">{money(preview.taxMinor)}</dd>
              </div>
            ) : null}
            {preview.shippingMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivery</dt>
                <dd className="tabular-nums">{money(preview.shippingMinor)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(preview.totalMinor)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Check the quantities and prices - one of them is not a number yet.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          The final amounts are recalculated on the server from your catalogue
          prices when you save.
        </p>
      </div>

      <SubmitButton className="sm:w-auto sm:min-w-44">
        {mode === "create" ? "Create order" : "Save changes"}
      </SubmitButton>
    </form>
  );
}

export function OrderFormDialog({
  mode,
  contacts,
  products,
  currency,
  defaults,
  triggerLabel,
  triggerVariant = "default",
  triggerClassName,
}: {
  mode: "create" | "edit";
  contacts: ContactOption[];
  products: ProductOption[];
  currency: CurrencyCode;
  defaults?: OrderFormDefaults;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "secondary";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const initial = defaults ?? emptyOrderDefaults();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="lg" className={triggerClassName}>
          {mode === "create" ? <Plus aria-hidden="true" /> : null}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New order" : "Edit order"}
          </DialogTitle>
          <DialogDescription>
            Pick the customer, add what they bought, and BizSakhi works out the
            total.
          </DialogDescription>
        </DialogHeader>
        {/* Remounting on open resets the draft rows to the saved values. */}
        {open ? (
          <OrderForm
            mode={mode}
            contacts={contacts}
            products={products}
            currency={currency}
            defaults={initial}
            onSaved={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
