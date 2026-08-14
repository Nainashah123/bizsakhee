import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { PrintInvoiceButton } from "@/components/invoice/print-invoice-button";
import { InvoicePrintStyles } from "@/components/invoice/print-styles";
import { getInvoiceByToken } from "@/features/orders/queries";

/**
 * A shared invoice, opened with nothing but the link.
 *
 * The URL *is* the credential, so this page:
 *   - runs on the Node.js runtime, because the token is hashed with node:crypto
 *     before it is ever compared against a stored value;
 *   - asks for no session and renders no application chrome;
 *   - shows one invoice and nothing else - no workspace, no other orders, no
 *     navigation into the dashboard;
 *   - is never indexed, and its metadata is a constant so a crawler cannot
 *     learn anything from a wrong token either.
 */

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function PublicInvoicePage({ params }: PageProps) {
  const { token } = await params;
  const result = await getInvoiceByToken(token);

  // An invalid, revoked or replaced token is indistinguishable from an order
  // that never existed.
  if (!result.ok) {
    if (result.error.code === "not_found") notFound();

    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16">
        <div className="w-full max-w-md text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <AlertTriangle className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-2xl font-bold tracking-tight">
            We could not open this invoice
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {result.error.message}
          </p>
        </div>
      </main>
    );
  }

  const invoice = result.data;

  return (
    <div className="min-h-dvh bg-background">
      <InvoicePrintStyles />

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="mb-4 flex justify-end">
          <PrintInvoiceButton label="Print or save as PDF" />
        </div>

        {/* The print stylesheet puts exactly this element on paper. */}
        <div
          data-invoice-print
          className="overflow-hidden rounded-xl border bg-card shadow-sm"
        >
          <InvoiceDocument
            invoice={{
              orderNumber: invoice.orderNumber,
              issuedOn: invoice.issuedOn,
              dueOn: invoice.dueOn,
              currency: invoice.currency,
              paymentStatus: invoice.paymentStatus,
              sellerName: invoice.sellerName,
              sellerCity: invoice.sellerCity,
              sellerWhatsApp: invoice.sellerWhatsApp,
              customerName: invoice.customerName,
              items: invoice.items,
              payments: invoice.payments,
              subtotalMinor: invoice.subtotalMinor,
              discountMinor: invoice.discountMinor,
              taxMinor: invoice.taxMinor,
              taxBasisPoints: invoice.taxBasisPoints,
              shippingMinor: invoice.shippingMinor,
              totalMinor: invoice.totalMinor,
              amountPaidMinor: invoice.amountPaidMinor,
              outstandingMinor: invoice.outstandingMinor,
              notes: invoice.notes,
            }}
          />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          This link opens only this invoice. Keep it private - anyone who has it
          can see this page.
        </p>
      </main>
    </div>
  );
}
