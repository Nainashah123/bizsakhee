"use client";

import { useRef } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONTACT_SORTS,
  CONTACT_SORT_LABELS,
  CONTACT_STATUS_FILTERS,
  NONE_VALUE,
  type ContactFilters,
} from "@/lib/validation/contacts";

const STATUS_FILTER_LABELS: Record<
  (typeof CONTACT_STATUS_FILTERS)[number],
  string
> = {
  active: "Active",
  archived: "Archived",
  all: "Everyone",
};

/**
 * A plain GET form, so search and filters work without JavaScript and every
 * result set has a shareable URL. With JavaScript the selects submit on change.
 */
export function ContactsFilters({
  filters,
  tags,
}: {
  filters: ContactFilters;
  tags: { id: string; name: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  const isFiltered =
    filters.search !== "" ||
    filters.status !== "active" ||
    filters.tagId !== null ||
    filters.sort !== "recent";

  return (
    <form
      ref={formRef}
      method="get"
      action="/dashboard/contacts"
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      role="search"
    >
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="contact-search">Search</Label>
        <div className="relative">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="contact-search"
            name="q"
            type="search"
            defaultValue={filters.search}
            placeholder="Name, phone or email"
            className="h-11 pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-status">Status</Label>
        <Select
          name="status"
          defaultValue={filters.status}
          onValueChange={submit}
        >
          <SelectTrigger id="contact-status" className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_STATUS_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_FILTER_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-tag">Tag</Label>
        <Select
          name="tag"
          defaultValue={filters.tagId ?? NONE_VALUE}
          onValueChange={submit}
        >
          <SelectTrigger id="contact-tag" className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Any tag</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-sort">Sort by</Label>
        <Select name="sort" defaultValue={filters.sort} onValueChange={submit}>
          <SelectTrigger id="contact-sort" className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {CONTACT_SORT_LABELS[sort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="secondary" className="h-11">
          <Search aria-hidden="true" />
          Apply
        </Button>
        {isFiltered ? (
          <Button asChild variant="ghost" className="h-11">
            <Link href="/dashboard/contacts">
              <X aria-hidden="true" />
              Clear filters
            </Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
