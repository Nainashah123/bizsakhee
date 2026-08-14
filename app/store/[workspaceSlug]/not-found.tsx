import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A private catalogue and a missing one render exactly the same page, so this
 * cannot be used to discover which workspace slugs exist.
 */
export default function StorefrontNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <SearchX className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">
          This catalogue is not available
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The link may be mistyped, or the business may have taken their
          catalogue offline. If someone shared it with you, ask them to check
          the address.
        </p>

        <Button asChild className="mt-6">
          <Link href="/">Go to BizSakhi</Link>
        </Button>
      </div>
    </main>
  );
}
