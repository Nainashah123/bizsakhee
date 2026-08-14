"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { exportContactsAction } from "@/features/contacts/actions";
import type { ContactFilters } from "@/lib/validation/contacts";

/**
 * Downloads exactly the rows the current filters describe. The CSV is built on
 * the server (so it obeys workspace scoping) and saved from a blob here.
 */
export function ContactsExportButton({ filters }: { filters: ContactFilters }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const download = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("search", filters.search);
      formData.set("status", filters.status);
      formData.set("sort", filters.sort);
      if (filters.tagId) formData.set("tagId", filters.tagId);

      const result = await exportContactsAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={download}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        Export CSV
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
