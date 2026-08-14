import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  contactFiltersToQuery,
  type ContactFilters,
} from "@/lib/validation/contacts";

export function ContactsPagination({
  filters,
  page,
  pageCount,
  total,
}: {
  filters: ContactFilters;
  page: number;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {total} customer{total === 1 ? "" : "s"}
      </p>
    );
  }

  const hrefFor = (target: number) =>
    `/dashboard/contacts${contactFiltersToQuery({ ...filters, page: target })}`;

  return (
    <nav
      className="flex items-center justify-between gap-3"
      aria-label="Customer list pages"
    >
      <p className="text-sm text-muted-foreground" role="status">
        Page {page} of {pageCount} - {total} customer
        {total === 1 ? "" : "s"}
      </p>

      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" className="h-10">
            <Link href={hrefFor(page - 1)} rel="prev">
              <ChevronLeft aria-hidden="true" />
              Previous
            </Link>
          </Button>
        ) : null}
        {page < pageCount ? (
          <Button asChild variant="outline" className="h-10">
            <Link href={hrefFor(page + 1)} rel="next">
              Next
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
