import Link from "next/link";
import { CalendarClock, MapPin, Phone, Mail } from "lucide-react";

import { WhatsAppButton } from "@/components/contacts/whatsapp-button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContactListItem } from "@/features/contacts/queries";
import { CONTACT_STATUS_LABELS } from "@/lib/validation/contacts";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function TagBadges({ tags }: { tags: ContactListItem["tags"] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li key={tag.id}>
          <Badge variant="secondary">{tag.name}</Badge>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: ContactListItem["status"] }) {
  if (status === "active") return null;
  return <Badge variant="outline">{CONTACT_STATUS_LABELS[status]}</Badge>;
}

/**
 * Cards on phones, a table from `lg`. Both render the same data from the same
 * props so nothing is hidden on one breakpoint only.
 */
export function ContactsList({ contacts }: { contacts: ContactListItem[] }) {
  return (
    <>
      <ul className="space-y-3 lg:hidden">
        {contacts.map((contact) => {
          const followUp = formatDate(contact.nextFollowUpAt);
          return (
            <li
              key={contact.id}
              className="rounded-xl border bg-card p-4 focus-within:ring-2 focus-within:ring-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/dashboard/contacts/${contact.id}`}
                    className="block truncate font-semibold hover:underline focus:outline-none"
                  >
                    {contact.fullName}
                  </Link>
                  {contact.phoneDisplay ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Phone className="size-3.5" aria-hidden="true" />
                      {contact.phoneDisplay}
                    </p>
                  ) : null}
                  {contact.email ? (
                    <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{contact.email}</span>
                    </p>
                  ) : null}
                  {contact.city ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5" aria-hidden="true" />
                      {contact.city}
                    </p>
                  ) : null}
                  {followUp ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      Follow up {followUp}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <StatusBadge status={contact.status} />
                  <WhatsAppButton
                    phoneNormalized={contact.phoneNormalized}
                    name={contact.fullName}
                    size="sm"
                    className="h-9"
                  />
                </div>
              </div>

              <div className="mt-3">
                <TagBadges tags={contact.tags} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Phone</TableHead>
              <TableHead scope="col">City</TableHead>
              <TableHead scope="col">Tags</TableHead>
              <TableHead scope="col">Next follow-up</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/contacts/${contact.id}`}
                    className="hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {contact.fullName}
                  </Link>
                  {contact.email ? (
                    <span className="block text-xs text-muted-foreground">
                      {contact.email}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums">
                  {contact.phoneDisplay ?? "-"}
                </TableCell>
                <TableCell>{contact.city ?? "-"}</TableCell>
                <TableCell>
                  <TagBadges tags={contact.tags} />
                </TableCell>
                <TableCell>
                  {formatDate(contact.nextFollowUpAt) ?? "-"}
                </TableCell>
                <TableCell>
                  {contact.status === "active" ? (
                    <span className="text-sm text-success">Active</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Archived
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <WhatsAppButton
                    phoneNormalized={contact.phoneNormalized}
                    name={contact.fullName}
                    size="sm"
                    className="h-9"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
