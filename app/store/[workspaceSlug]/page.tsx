import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CatalogueHeader } from "@/components/catalogue/catalogue-header";
import { CatalogueProductCard } from "@/components/catalogue/catalogue-product-card";
import { getPublicCatalogue } from "@/features/catalogue/queries";
import { isCurrencyCode } from "@/lib/money";

/**
 * Public catalogue - a Server Component with no dashboard chrome and no
 * session requirement.
 *
 * `getPublicCatalogue` returns null for a workspace that does not exist and
 * for one whose catalogue is switched off, and only ever selects products with
 * `status = 'published'`. Both are asserted in the query, not just in RLS.
 */

type PageProps = { params: Promise<{ workspaceSlug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const catalogue = await getPublicCatalogue(workspaceSlug);

  if (!catalogue) {
    return {
      title: "Catalogue not found",
      robots: { index: false, follow: false },
    };
  }

  const name = catalogue.business?.businessName ?? catalogue.workspace.name;
  const place = catalogue.business?.city
    ? ` in ${catalogue.business.city}`
    : "";
  const description =
    catalogue.business?.description ??
    `Browse ${catalogue.products.length} products from ${name}${place} and enquire on WhatsApp.`;

  return {
    title: `${name} - Catalogue`,
    description: description.slice(0, 200),
    openGraph: {
      title: `${name} - Catalogue`,
      description: description.slice(0, 200),
      type: "website",
    },
  };
}

export default async function StorefrontPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const catalogue = await getPublicCatalogue(workspaceSlug);

  if (!catalogue) notFound();

  const { workspace, business, products } = catalogue;
  const businessName = business?.businessName ?? workspace.name;
  const currency = isCurrencyCode(workspace.currency)
    ? workspace.currency
    : "INR";

  return (
    <div className="min-h-dvh bg-background">
      <CatalogueHeader
        businessName={businessName}
        city={business?.city ?? null}
        description={business?.description ?? null}
        whatsappNumber={business?.whatsappNumber ?? null}
        instagramHandle={business?.instagramHandle ?? null}
        productCount={products.length}
      />

      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <h2 className="sr-only">Products</h2>

        {products.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="text-lg font-semibold">
              Nothing is listed here just yet
            </p>
            <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
              {businessName} has not published any products yet. Do check back,
              or message them directly using the button above.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <li key={product.id}>
                <CatalogueProductCard
                  product={product}
                  currency={currency}
                  businessName={businessName}
                  whatsappNumber={business?.whatsappNumber ?? null}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground">
          Catalogue by {businessName}. Prices shown in {currency}.
        </div>
      </footer>
    </div>
  );
}
