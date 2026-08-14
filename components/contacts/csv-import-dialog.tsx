"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Upload,
} from "lucide-react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  confirmContactImportAction,
  previewContactImportAction,
  type ImportState,
} from "@/features/contacts/actions";
import { CONTACT_IMPORT_TEMPLATE } from "@/lib/contacts/csv";

const EMPTY: ImportState = {};

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Upload, preview, confirm. Nothing is written until the user has seen exactly
 * which rows will be created, which were rejected and why, and which already
 * exist in the workspace.
 */
export function CsvImportDialog() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState<string | null>(null);

  const [previewState, preview] = useActionState(
    previewContactImportAction,
    EMPTY,
  );
  const [importState, confirm] = useActionState(
    confirmContactImportAction,
    EMPTY,
  );

  const result = importState.imported;
  const rows = previewState.preview;

  const reset = () => {
    setCsv("");
    setFileName("");
    setReadError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10">
          <Upload aria-hidden="true" />
          Import CSV
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import customers from a CSV</DialogTitle>
          <DialogDescription>
            Your file needs a column headed Name. Phone, Email, City, Lead
            source and Tags are used when they are present.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <FormAlert variant="success">{importState.message}</FormAlert>

            {result.skipped.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {result.skipped.length} row
                  {result.skipped.length === 1 ? "" : "s"} were skipped
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {result.skipped.map((row) => (
                    <li key={row.line}>
                      Row {row.line} - {row.label}: {row.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              type="button"
              className="h-11"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              <CheckCircle2 aria-hidden="true" />
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <form action={preview} className="space-y-4">
              <input type="hidden" name="csv" value={csv} />

              <div className="space-y-2">
                <Label htmlFor="csv-file">CSV file</Label>
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="block w-full rounded-lg border bg-background px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    setReadError(null);
                    if (!file) {
                      reset();
                      return;
                    }
                    try {
                      const text = await file.text();
                      setCsv(text);
                      setFileName(file.name);
                    } catch {
                      setCsv("");
                      setFileName("");
                      setReadError("We could not read that file.");
                    }
                  }}
                />
                {fileName ? (
                  <p className="text-sm text-muted-foreground">
                    Ready to check: {fileName}
                  </p>
                ) : null}
              </div>

              <FormAlert variant="error">
                {readError ?? previewState.error}
              </FormAlert>

              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton className="h-11 sm:w-auto sm:min-w-44">
                  Check this file
                </SubmitButton>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={() =>
                    downloadText(
                      "bizsakhi-contacts-template.csv",
                      CONTACT_IMPORT_TEMPLATE,
                    )
                  }
                >
                  <Download aria-hidden="true" />
                  Download a template
                </Button>
              </div>
            </form>

            {rows ? (
              <div className="space-y-5 border-t pt-5">
                <div className="grid gap-2 sm:grid-cols-3">
                  <SummaryTile
                    label="Ready to import"
                    value={rows.valid.length}
                    tone="success"
                  />
                  <SummaryTile
                    label="Already saved"
                    value={rows.duplicates.length}
                    tone="warning"
                  />
                  <SummaryTile
                    label="Cannot import"
                    value={rows.invalid.length}
                    tone="destructive"
                  />
                </div>

                {rows.valid.length > 0 ? (
                  <section aria-labelledby="import-valid" className="space-y-2">
                    <h3 id="import-valid" className="text-sm font-semibold">
                      These will be added
                    </h3>
                    <div className="max-h-64 overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead scope="col">Row</TableHead>
                            <TableHead scope="col">Name</TableHead>
                            <TableHead scope="col">Phone</TableHead>
                            <TableHead scope="col">Email</TableHead>
                            <TableHead scope="col">City</TableHead>
                            <TableHead scope="col">Tags</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.valid.map((row) => (
                            <TableRow key={row.line}>
                              <TableCell className="tabular-nums">
                                {row.line}
                              </TableCell>
                              <TableCell className="font-medium">
                                {row.fullName}
                              </TableCell>
                              <TableCell>{row.phone ?? "-"}</TableCell>
                              <TableCell>{row.email ?? "-"}</TableCell>
                              <TableCell>{row.city ?? "-"}</TableCell>
                              <TableCell>
                                {row.tags.length > 0
                                  ? row.tags.join(", ")
                                  : "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                ) : null}

                {rows.duplicates.length > 0 ? (
                  <section
                    aria-labelledby="import-duplicates"
                    className="space-y-2"
                  >
                    <h3
                      id="import-duplicates"
                      className="text-sm font-semibold"
                    >
                      Already in your list - these are skipped
                    </h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {rows.duplicates.map((row) => (
                        <li key={row.line} className="flex flex-wrap gap-1">
                          <Copy
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            Row {row.line} - {row.label}: {row.reason}
                          </span>
                          {row.contactId ? (
                            <Link
                              href={`/dashboard/contacts/${row.contactId}`}
                              className="font-medium text-foreground underline underline-offset-2"
                            >
                              Open
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {rows.invalid.length > 0 ? (
                  <section
                    aria-labelledby="import-invalid"
                    className="space-y-2"
                  >
                    <h3 id="import-invalid" className="text-sm font-semibold">
                      These rows need fixing in your file
                    </h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {rows.invalid.map((row) => (
                        <li key={row.line} className="flex gap-1">
                          <AlertTriangle
                            className="mt-0.5 size-3.5 shrink-0 text-destructive"
                            aria-hidden="true"
                          />
                          <span>
                            Row {row.line} - {row.label}:{" "}
                            {row.reasons.join(" ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <form action={confirm} className="space-y-3">
                  <input type="hidden" name="csv" value={rows.csv} />
                  <FormAlert variant="error">{importState.error}</FormAlert>
                  {rows.valid.length > 0 ? (
                    <SubmitButton className="h-11 sm:w-auto sm:min-w-56">
                      Import {rows.valid.length} customer
                      {rows.valid.length === 1 ? "" : "s"}
                    </SubmitButton>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      There is nothing to import from this file yet. Fix the
                      rows above and upload it again.
                    </p>
                  )}
                </form>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-foreground"
        : "text-destructive";

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}
