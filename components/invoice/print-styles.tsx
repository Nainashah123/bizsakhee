const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }

  html, body {
    background: white !important;
    color: black !important;
  }

  /* Hide the application shell without unmounting it, then reveal only the
     invoice. Visibility (rather than display) keeps the printed layout stable
     while the invoice is lifted to the top of the page. */
  body * { visibility: hidden !important; }

  [data-invoice-print],
  [data-invoice-print] * { visibility: visible !important; }

  [data-invoice-print] {
    display: block !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    box-shadow: none !important;
    background: white !important;
  }

  [data-print-hidden] { display: none !important; }

  a[href]::after { content: "" !important; }
}
`;

/**
 * Print rules for the invoice.
 *
 * Declared next to the invoice rather than in the global stylesheet so the
 * behaviour travels with the component, and so nothing in the rest of the app
 * has to know about printing.
 */
export function InvoicePrintStyles() {
  return <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />;
}
