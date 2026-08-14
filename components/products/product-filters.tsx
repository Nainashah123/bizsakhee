import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  type ProductStatusValue,
} from "@/lib/validation/products";

/**
 * Search and status filter.
 *
 * A plain GET form, so filtering works without JavaScript and every result is
 * a shareable, bookmarkable URL. A native `select` is used deliberately: it
 * needs no client bundle and gets the platform's keyboard behaviour for free.
 */
export function ProductFilters({
  q,
  status,
  counts,
}: {
  q?: string;
  status?: ProductStatusValue;
  counts: { all: number; draft: number; published: number; archived: number };
}) {
  return (
    <form
      action="/dashboard/products"
      method="get"
      role="search"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="product-search">Search products</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="product-search"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder="Name or SKU"
            className="h-11 pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5 sm:w-52">
        <Label htmlFor="product-status">Status</Label>
        <select
          id="product-status"
          name="status"
          defaultValue={status ?? ""}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">All statuses ({counts.all})</option>
          {PRODUCT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PRODUCT_STATUS_LABELS[value]} ({counts[value]})
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary" className="h-11 sm:w-auto">
        Apply
      </Button>
    </form>
  );
}
