import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { ImageManager } from "@/components/products/image-manager";
import { ProductForm } from "@/components/products/product-form";
import { ProductStatusActions } from "@/components/products/product-status-actions";
import { ProductStatusBadge } from "@/components/products/product-status-badge";
import { VariantEditor } from "@/components/products/variant-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProductDetail } from "@/features/products/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { isCurrencyCode, toMajorUnits, type CurrencyCode } from "@/lib/money";
import { isUuid } from "@/lib/storage/paths";

const NEW = "new";

type PageProps = { params: Promise<{ id: string }> };

/** Minor units back to the string a person types into the price field. */
function majorInput(minor: number | null, currency: CurrencyCode): string {
  if (minor === null) return "";
  return toMajorUnits(Number(minor), currency).toFixed(2);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (id === NEW) return { title: "New product" };

  const { workspace } = await requireWorkspace();
  if (!isUuid(id)) return { title: "Product" };

  const detail = await getProductDetail(workspace.id, id);
  return { title: detail ? detail.product.name : "Product" };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();

  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";

  if (id === NEW) {
    return (
      <div className="max-w-3xl space-y-6">
        <BackLink />

        <div>
          <h1 className="text-2xl font-bold tracking-tight">New product</h1>
          <p className="text-sm text-muted-foreground">
            Save the basics first - photos and options can be added straight
            afterwards.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm
              mode="create"
              currency={currency}
              defaults={{
                name: "",
                slug: "",
                description: "",
                sku: "",
                price: "",
                salePrice: "",
                stockStatus: "in_stock",
                stockQuantity: "",
                status: "draft",
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isUuid(id)) notFound();

  const detail = await getProductDetail(workspace.id, id);
  if (!detail) notFound();

  const { product, variants, images } = detail;

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {product.name}
            </h1>
            <ProductStatusBadge status={product.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Catalogue link:{" "}
            <span className="font-mono break-all">
              /store/{workspace.slug}#{product.slug}
            </span>
          </p>
        </div>

        {product.status === "published" && workspace.isCataloguePublic ? (
          <Button asChild variant="outline">
            <Link href={`/store/${workspace.slug}#${product.slug}`}>
              <ExternalLink aria-hidden="true" />
              View in catalogue
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Visibility</CardTitle>
          <p className="text-sm text-muted-foreground">
            Only published products appear on your public catalogue. Drafts and
            archived products stay private.
          </p>
        </CardHeader>
        <CardContent>
          <ProductStatusActions
            productId={product.id}
            status={product.status}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductForm
            mode="edit"
            currency={currency}
            defaults={{
              productId: product.id,
              name: product.name,
              slug: product.slug,
              description: product.description ?? "",
              sku: product.sku ?? "",
              price: majorInput(Number(product.price_minor), currency),
              salePrice: majorInput(
                product.sale_price_minor === null
                  ? null
                  : Number(product.sale_price_minor),
                currency,
              ),
              stockStatus: product.stock_status,
              stockQuantity:
                product.stock_quantity === null
                  ? ""
                  : String(product.stock_quantity),
              status: product.status,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageManager
            productId={product.id}
            productName={product.name}
            images={images.map((image) => ({
              id: image.id,
              storagePath: image.storage_path,
              altText: image.alt_text,
              width: image.width,
              height: image.height,
              position: image.position,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Options</CardTitle>
        </CardHeader>
        <CardContent>
          <VariantEditor
            productId={product.id}
            currency={currency}
            variants={variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              sku: variant.sku ?? "",
              price: majorInput(
                variant.price_minor === null
                  ? null
                  : Number(variant.price_minor),
                currency,
              ),
              stockQuantity:
                variant.stock_quantity === null
                  ? ""
                  : String(variant.stock_quantity),
              position: variant.position,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/products"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      All products
    </Link>
  );
}
