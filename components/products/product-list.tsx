import Image from "next/image";
import Link from "next/link";
import { ImageOff, Layers, Plus } from "lucide-react";

import {
  ProductStatusBadge,
  StockBadge,
} from "@/components/products/product-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductListItem } from "@/features/products/queries";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { productImageUrl } from "@/lib/storage/paths";

/**
 * Mobile-first product list: cards on small screens, a table from `lg`. Both
 * render the same data, so nothing is hidden from either viewport.
 */
export function ProductList({
  items,
  currency,
}: {
  items: ProductListItem[];
  currency: CurrencyCode;
}) {
  return (
    <>
      <ul className="space-y-3 lg:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <ProductCard item={item} currency={currency} />
          </li>
        ))}
      </ul>

      <Card className="hidden lg:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">
                  <span className="sr-only">Photo</span>
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Thumbnail item={item} size={44} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/products/${item.id}`}
                      className="font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {item.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.sku ? `SKU ${item.sku} - ` : ""}/{item.slug}
                      {item.variantCount > 0
                        ? ` - ${item.variantCount} option${item.variantCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>
                    <StockBadge
                      stockStatus={item.stockStatus}
                      quantity={item.stockQuantity}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Price item={item} currency={currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function ProductCard({
  item,
  currency,
}: {
  item: ProductListItem;
  currency: CurrencyCode;
}) {
  return (
    <Card>
      <CardContent className="flex gap-3 p-3">
        <Thumbnail item={item} size={64} />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/dashboard/products/${item.id}`}
              className="min-w-0 font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {item.name}
            </Link>
            <ProductStatusBadge status={item.status} />
          </div>

          <p className="truncate text-xs text-muted-foreground">
            {item.sku ? `SKU ${item.sku} - ` : ""}/{item.slug}
          </p>

          <div className="flex items-center justify-between gap-2">
            <StockBadge
              stockStatus={item.stockStatus}
              quantity={item.stockQuantity}
            />
            <Price item={item} currency={currency} />
          </div>

          {item.variantCount > 0 ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Layers className="size-3" aria-hidden="true" />
              {item.variantCount} option{item.variantCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Thumbnail({ item, size }: { item: ProductListItem; size: number }) {
  if (!item.imagePath) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <ImageOff className="size-4" aria-hidden="true" />
        <span className="sr-only">No photo yet</span>
      </div>
    );
  }

  return (
    <Image
      src={productImageUrl(item.imagePath)}
      alt={item.imageAlt || item.name}
      width={size}
      height={size}
      className="shrink-0 rounded-lg border object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function Price({
  item,
  currency,
}: {
  item: ProductListItem;
  currency: CurrencyCode;
}) {
  if (item.salePriceMinor === null) {
    return (
      <span className="text-sm font-semibold">
        {formatMoney(item.priceMinor, currency)}
      </span>
    );
  }

  return (
    <span className="text-sm font-semibold">
      {formatMoney(item.salePriceMinor, currency)}{" "}
      <s className="font-normal text-muted-foreground">
        {formatMoney(item.priceMinor, currency)}
      </s>
    </span>
  );
}

export function ProductsEmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <Card>
        <CardContent className="space-y-4 py-10 text-center">
          <h2 className="text-lg font-semibold">No products match that</h2>
          <p className="mx-auto max-w-prose text-sm text-muted-foreground">
            Try a different word, or clear the filters to see everything in your
            catalogue.
          </p>
          <Button asChild variant="secondary">
            <Link href="/dashboard/products">Clear filters</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-10 text-center">
        <h2 className="text-lg font-semibold">Add your first product</h2>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">
          Add one product with a photo and a price. Publish it and it appears on
          your public catalogue link, ready to share on WhatsApp.
        </p>
        <Button asChild>
          <Link href="/dashboard/products/new">
            <Plus aria-hidden="true" />
            Add a product
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProductsErrorState() {
  return (
    <Card>
      <CardContent className="space-y-3 py-10 text-center">
        <h2 className="text-lg font-semibold">
          We could not load your products
        </h2>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">
          This is usually temporary. Reload the page - if it keeps happening,
          check that your Supabase project is reachable.
        </p>
        <Button asChild variant="secondary">
          <Link href="/dashboard/products">Try again</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
