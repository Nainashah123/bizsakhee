import Link from "next/link";
import { ExternalLink, MessageCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The reassurance that matters most on this screen.
 *
 * Most sellers will never get a Meta app approved, and they do not need one.
 * Every "Message on WhatsApp" button in BizSakhi is a `wa.me` deep link that
 * opens the seller's own WhatsApp - no API, no review, no credentials. Saying
 * so here is what keeps "Setup required" from reading as "your product is
 * broken".
 */
export function DeepLinkNotice() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
            <MessageCircle className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <CardTitle>WhatsApp already works, without any of this</CardTitle>
            <p className="text-sm text-muted-foreground">
              Connecting a channel is an upgrade, not a requirement.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Every customer with a WhatsApp number has a{" "}
          <span className="font-medium text-foreground">
            Message on WhatsApp
          </span>{" "}
          button that opens the chat in your own WhatsApp, with the message
          already written. Order confirmations, payment reminders and follow-ups
          all use it. That needs no Meta app, no approval and no credentials,
          and it will keep working whether or not a channel below is ever
          connected.
        </p>
        <p>
          What connecting a channel adds is the other direction: incoming
          messages landing in BizSakhi automatically, instead of you copying
          them across.
        </p>
        <p>
          <Link
            href="/dashboard/contacts"
            className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            See it on your customers
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
