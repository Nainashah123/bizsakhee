"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Opens the browser's print dialog. The print stylesheet decides what lands on
 * paper, so there is no separate "print view" route to keep in sync.
 */
export function PrintInvoiceButton({
  label = "Print invoice",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className={className}
      onClick={() => window.print()}
    >
      <Printer aria-hidden="true" />
      {label}
    </Button>
  );
}
