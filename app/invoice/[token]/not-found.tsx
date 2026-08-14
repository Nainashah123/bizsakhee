import { ReceiptText } from "lucide-react";

/**
 * A revoked link, a replaced link and a link that never existed all render this
 * same page, and it reads no data of its own - so nothing about the order, the
 * business or the customer can be learnt from a wrong token.
 */
export default function InvoiceNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ReceiptText className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">
          This invoice link is not valid
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The link may have been mistyped, or the business may have replaced or
          revoked it. Ask them to send you a fresh invoice link - it only takes
          them a moment.
        </p>
      </div>
    </main>
  );
}
