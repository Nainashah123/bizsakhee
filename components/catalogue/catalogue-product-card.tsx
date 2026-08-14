import Image from "next/image";
import { ImageOff, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CatalogueProduct } from "@/features/catalogue/queries";
import { whatsappLink } from "@/lib/contacts/normalize";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { productImageUrl } from "@/lib/storage/paths";
import { STOCK_STATUS_LABELS } from "@/lib/validation/products";

/**
 * One product on the public catalogue.
 *
 * The enquiry button is a WhatsApp deep link with the product name prefilled,
 * built by `whatsappLink()`. When the business has no WhatsApp number the
 * button is not rendered at all rather than pointing nowhere.
 */
export function CatalogueProductCard({
  product,
  currency,
  businessName,
  whatsappNumber,
}: {
  product: CatalogueProduct;
  currency: CurrencyCode;
  businessName: string;
  whatsappNumber: string | null;
}) {
  const hasSale =
    product.salePriceMinor !== null &&
    product.salePriceMinor < product.priceMinor;

  const enquiry = whatsappNumber
    ? whatsappLink(
        whatsappNumber,
        `Hi ${businessName}, I would like to order "${product.name}" from your catalogue.`,
      )
    : null;

  return (
    <Card id={product.slug} className="flex h-full scroll-mt-8 flex-col">
      <div className="relative aspect-square overflow-hidden rounded-t-xl bg-muted">
        {product.image ? (
          <Image
            src={productImageUrl(product.image.storagePath)}
            alt={product.image.altText || product.name}
            fill
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" aria-hidden="true" />
            <span className="sr-only">No photo for {product.name}</span>
          </div>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-semibold">{product.name}</h3>

        <p className="text-sm">
          {hasSale && product.salePriceMinor !== null ? (
            <>
              <span className="font-semibold">
                {formatMoney(product.salePriceMinor, currency)}
              </span>{" "}
              <s className="text-muted-foreground">
                {formatMoney(product.priceMinor, currency)}
              </s>
            </>
          ) : (
            <span className="font-semibold">
              {formatMoney(product.priceMinor, currency)}
            </span>
          )}
        </p>

        <p
          className={
            product.stockStatus === "out_of_stock"
              ? "text-xs font-medium text-destructive"
              : "text-xs font-medium text-muted-foreground"
          }
        >
          {STOCK_STATUS_LABELS[product.stockStatus]}
        </p>

        {product.description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {product.description}
          </p>
        ) : null}

        {product.variants.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Options:{" "}
            {product.variants.map((variant) => variant.name).join(", ")}
          </p>
        ) : null}

        {enquiry ? (
          <Button asChild size="lg" className="mt-auto w-full">
            <a href={enquiry} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              Enquire on WhatsApp
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
