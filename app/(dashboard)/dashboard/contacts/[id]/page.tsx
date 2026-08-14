import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Mail,
  MapPin,
  Phone,
  Sparkles,
} from "lucide-react";

import { ChannelManager } from "@/components/contacts/channel-manager";
import { ContactDialog } from "@/components/contacts/contact-dialog";
import { ContactStatusButton } from "@/components/contacts/contact-status-button";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { NoteComposer } from "@/components/contacts/note-composer";
import { TagManager } from "@/components/contacts/tag-manager";
import { WhatsAppButton } from "@/components/contacts/whatsapp-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getContactDetail,
  getContactTimeline,
  listTags,
  listWorkspacePeople,
} from "@/features/contacts/queries";
import { requireWorkspace } from "@/lib/auth/session";
import { CONTACT_STATUS_LABELS } from "@/lib/validation/contacts";

export const metadata: Metadata = { title: "Customer" };

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspace } = await requireWorkspace();
  const { id } = await params;

  const detail = await getContactDetail(workspace.id, id);
  if (!detail) notFound();

  const [timeline, allTags, people] = await Promise.all([
    getContactTimeline(workspace.id, id),
    listTags(workspace.id),
    listWorkspacePeople(workspace.id),
  ]);

  const { contact, channels, notes } = detail;
  const followUp = formatWhen(contact.nextFollowUpAt);
  const assignee = people.find(
    (person) => person.userId === contact.assignedTo,
  );

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="-ml-2 h-9">
        <Link href="/dashboard/contacts">
          <ArrowLeft aria-hidden="true" />
          All customers
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {contact.fullName}
            </h1>
            {contact.status === "archived" ? (
              <Badge variant="outline">
                {CONTACT_STATUS_LABELS[contact.status]}
              </Badge>
            ) : null}
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
            {contact.phoneDisplay ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Phone</dt>
                <Phone className="size-3.5" aria-hidden="true" />
                <dd className="tabular-nums">{contact.phoneDisplay}</dd>
              </div>
            ) : null}
            {contact.email ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Email</dt>
                <Mail className="size-3.5" aria-hidden="true" />
                <dd className="truncate">{contact.email}</dd>
              </div>
            ) : null}
            {contact.city ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">City</dt>
                <MapPin className="size-3.5" aria-hidden="true" />
                <dd>{contact.city}</dd>
              </div>
            ) : null}
            {contact.leadSource ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Found you through</dt>
                <Sparkles className="size-3.5" aria-hidden="true" />
                <dd>Found you through {contact.leadSource}</dd>
              </div>
            ) : null}
            {followUp ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Next follow-up</dt>
                <CalendarClock className="size-3.5" aria-hidden="true" />
                <dd>Follow up {followUp}</dd>
              </div>
            ) : null}
            {assignee ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Looked after by</dt>
                <dd>Looked after by {assignee.name}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WhatsAppButton
            phoneNormalized={contact.phoneNormalized}
            name={contact.fullName}
            className="h-10"
          />
          <ContactDialog
            people={people}
            mode="edit"
            defaults={{
              contactId: contact.id,
              fullName: contact.fullName,
              phone: contact.phoneDisplay ?? contact.phoneNormalized ?? "",
              email: contact.email ?? "",
              city: contact.city ?? "",
              leadSource: contact.leadSource ?? "",
              status: contact.status,
              assignedTo: contact.assignedTo,
              nextFollowUpAt: contact.nextFollowUpAt,
            }}
            triggerClassName="h-10"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Add a note</CardTitle>
            </CardHeader>
            <CardContent>
              <NoteComposer contactId={contact.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <p className="text-sm text-muted-foreground">
                Notes, follow-ups, orders and messages together, newest first.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {timeline.failed ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                >
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    Part of this history could not be loaded. What you can see
                    below is still accurate.
                  </span>
                </p>
              ) : null}
              <ContactTimeline entries={timeline.entries} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes ({notes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notes yet. The box above is the fastest way to remember
                  what was agreed.
                </p>
              ) : (
                <ul className="divide-y">
                  {notes.map((note) => (
                    <li key={note.id} className="space-y-1 py-3 first:pt-0">
                      <time
                        dateTime={note.createdAt}
                        className="text-xs text-muted-foreground"
                      >
                        {formatWhen(note.createdAt)}
                      </time>
                      <p className="text-sm whitespace-pre-line">{note.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagManager
                contactId={contact.id}
                tags={contact.tags}
                allTags={allTags}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ways to reach them</CardTitle>
              <p className="text-sm text-muted-foreground">
                One channel can be primary - that is the one you reach for
                first.
              </p>
            </CardHeader>
            <CardContent>
              <ChannelManager contactId={contact.id} channels={channels} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {contact.status === "active" ? "Archive" : "Restore"}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {contact.status === "active"
                  ? "Archiving hides this customer from your active list. Nothing is deleted."
                  : "Restoring puts this customer back in your active list."}
              </p>
            </CardHeader>
            <CardContent>
              <ContactStatusButton
                contactId={contact.id}
                status={contact.status}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
