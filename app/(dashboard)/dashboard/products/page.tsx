import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";

import { ProductFilters } from "@/components/products/product-filters";
import {
  ProductList,
  ProductsEmptyState,
  ProductsErrorState,
} from "@/components/products/product-list";
import { Button } from "@/components/ui/button";
import { listProducts } from "@/features/products/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { isCurrencyCode } from "@/lib/money";
import { productListParamsSchema } from "@/lib/validation/products";

export const metadata: Metadata = {
  title: "Products",
  description: "Your catalogue: prices, photos, stock and what is published.",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const raw = await searchParams;

  // Query strings are user input like any other: validated, never trusted.
  const params = productListParamsSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
  });

  const { items, counts, isEmptyWorkspace, failed } = await listProducts(
    workspace.id,
    params,
  );

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";
  const isFiltered = Boolean(params.q || params.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            {counts.published} published, {counts.draft} draft,{" "}
            {counts.archived} archived.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {workspace.isCataloguePublic ? (
            <Button asChild variant="outline" size="lg">
              <Link href={`/store/${workspace.slug}`}>
                <ExternalLink aria-hidden="true" />
                View catalogue
              </Link>
            </Button>
          ) : null}
          <Button asChild size="lg">
            <Link href="/dashboard/products/new">
              <Plus aria-hidden="true" />
              Add product
            </Link>
          </Button>
        </div>
      </div>

      {!workspace.isCataloguePublic ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
          Your public catalogue is switched off, so published products are not
          visible to anyone yet.{" "}
          <Link
            href="/dashboard/settings"
            className="font-medium underline underline-offset-4"
          >
            Turn it on in Settings
          </Link>
          .
        </p>
      ) : null}

      {failed ? (
        <ProductsErrorState />
      ) : (
        <>
          {isEmptyWorkspace ? null : (
            <ProductFilters
              q={params.q}
              status={params.status}
              counts={counts}
            />
          )}

          {items.length === 0 ? (
            <ProductsEmptyState filtered={isFiltered && !isEmptyWorkspace} />
          ) : (
            <ProductList items={items} currency={currency} />
          )}
        </>
      )}
    </div>
  );
}
