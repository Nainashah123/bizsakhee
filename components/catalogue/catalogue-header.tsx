import { Instagram, MapPin, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappLink } from "@/lib/contacts/normalize";

/**
 * The shop front header. Public page: no dashboard chrome, no session, and
 * every contact affordance is only rendered when the detail actually exists.
 */
export function CatalogueHeader({
  businessName,
  city,
  description,
  whatsappNumber,
  instagramHandle,
  productCount,
}: {
  businessName: string;
  city: string | null;
  description: string | null;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  productCount: number;
}) {
  const handle = instagramHandle?.replace(/^@/, "");

  return (
    <header className="border-b bg-card">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {businessName}
        </h1>

        {city ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4" aria-hidden="true" />
            {city}
          </p>
        ) : null}

        {description ? (
          <p className="mt-4 max-w-prose text-base text-muted-foreground">
            {description}
          </p>
        ) : null}

        <p className="mt-4 text-sm text-muted-foreground">
          {productCount} {productCount === 1 ? "product" : "products"} available
        </p>

        {whatsappNumber || handle ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {whatsappNumber ? (
              <Button asChild size="lg">
                <a
                  href={whatsappLink(
                    whatsappNumber,
                    `Hi ${businessName}, I found your catalogue and would like to know more.`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle aria-hidden="true" />
                  Message on WhatsApp
                </a>
              </Button>
            ) : null}

            {handle ? (
              <Button asChild variant="outline" size="lg">
                <a
                  href={`https://instagram.com/${handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Instagram aria-hidden="true" />@{handle}
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
