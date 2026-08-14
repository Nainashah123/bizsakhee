import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Users } from "lucide-react";

import { ContactDialog } from "@/components/contacts/contact-dialog";
import { ContactsExportButton } from "@/components/contacts/contacts-export-button";
import { ContactsFilters } from "@/components/contacts/contacts-filters";
import { ContactsList } from "@/components/contacts/contacts-list";
import { ContactsPagination } from "@/components/contacts/contacts-pagination";
import { CsvImportDialog } from "@/components/contacts/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  listContacts,
  listTags,
  listWorkspacePeople,
} from "@/features/contacts/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { parseContactFilters } from "@/lib/validation/contacts";

export const metadata: Metadata = { title: "Customers" };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireWorkspace();
  const filters = parseContactFilters(await searchParams);

  const [result, tags, people] = await Promise.all([
    listContacts(workspace.id, filters),
    listTags(workspace.id),
    listWorkspacePeople(workspace.id),
  ]);

  const isFiltered =
    filters.search !== "" ||
    filters.status !== "active" ||
    filters.tagId !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Everyone you have spoken to, in one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CsvImportDialog />
          <ContactsExportButton filters={filters} />
          <ContactDialog people={people} />
        </div>
      </div>

      <ContactsFilters filters={filters} tags={tags} />

      {result.failed ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              We could not load your customers
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              The list did not come back from the database this time. Nothing
              has been lost - try again in a moment.
            </p>
            <Button asChild variant="outline" className="h-10">
              <Link href="/dashboard/contacts">Try again</Link>
            </Button>
          </CardContent>
        </Card>
      ) : result.contacts.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-center gap-2 text-lg font-semibold">
              <Users className="size-5" aria-hidden="true" />
              {isFiltered
                ? "No customers match these filters"
                : "Add your first customer"}
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              {isFiltered
                ? "Try a different search, another status, or clear the filters to see everyone."
                : "Start with the person you spoke to most recently. Once they are saved you can message them on WhatsApp, add notes and set a follow-up."}
            </p>
            <div className="flex flex-wrap gap-2">
              {isFiltered ? (
                <Button asChild variant="outline" className="h-10">
                  <Link href="/dashboard/contacts">Clear filters</Link>
                </Button>
              ) : null}
              <ContactDialog
                people={people}
                triggerLabel="Add your first customer"
              />
              <CsvImportDialog />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <ContactsList contacts={result.contacts} />
          <ContactsPagination
            filters={filters}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
          />
        </div>
      )}
    </div>
  );
}
