import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  IndianRupee,
  MessageCircle,
  Package,
  Sparkles,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const OUTCOMES = [
  {
    icon: Users,
    title: "Every enquiry in one list",
    body: "Customers from WhatsApp, Instagram and referrals land in a single contact list with their channel, source and history.",
  },
  {
    icon: CalendarClock,
    title: "Nobody gets forgotten",
    body: "Follow-ups carry a date and an owner, so the customer who said “I'll confirm tomorrow” actually hears from you tomorrow.",
  },
  {
    icon: Package,
    title: "Orders that add up",
    body: "Build an order from a chat, apply discount, tax and shipping, and let the total be calculated for you — never in your head.",
  },
  {
    icon: IndianRupee,
    title: "Know what is still unpaid",
    body: "Record full or partial payments and see outstanding amounts per customer instead of scrolling through screenshots.",
  },
  {
    icon: MessageCircle,
    title: "A catalogue you can share",
    body: "Publish products to a link you can drop into a status, bio or chat — each product has its own WhatsApp enquiry button.",
  },
  {
    icon: Sparkles,
    title: "Writing help when you're stuck",
    body: "Draft a reply or a post caption in your language and tone. You read it, edit it, and decide whether to send it.",
  },
];

const AUDIENCES = [
  "Boutiques",
  "Jewellery sellers",
  "Home bakers",
  "Cloud kitchens",
  "Makeup artists",
  "Mehendi artists",
  "Tutors & coaches",
  "Freelancers",
  "Resellers",
  "Salon & home services",
];

export default function HomePage() {
  return (
    <>
      <section className="bg-gradient-to-b from-secondary/70 via-background to-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold tracking-wide text-accent uppercase">
              Business, organised
            </p>
            <h1 className="mt-3 text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Turn your WhatsApp and Instagram business into an organised,
              growing brand.
            </h1>
            <p className="mt-6 text-lg text-pretty text-muted-foreground">
              BizSakhi keeps your customers, orders, payments, follow-ups and
              product catalogue in one place — built for the phone you already
              run your business from.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 text-base">
                <Link href="/signup">
                  Start free <ArrowRight className="ml-1" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 text-base"
              >
                <Link href="/features">See what&apos;s inside</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Free plan available. No card required to start.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          What changes on day one
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Not more apps to check — one place where the work you already do stops
          slipping through the cracks.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OUTCOMES.map((item) => (
            <Card key={item.title} className="h-full">
              <CardContent className="space-y-3 pt-6">
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y bg-secondary/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Made for businesses run on chat
          </h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {AUDIENCES.map((audience) => (
              <li
                key={audience}
                className="rounded-full border bg-background px-4 py-2 text-sm font-medium"
              >
                {audience}
              </li>
            ))}
          </ul>
          <Button asChild variant="link" className="mt-4 px-0">
            <Link href="/industries">
              See how each one uses BizSakhi <ArrowRight className="ml-1" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="rounded-3xl bg-primary px-6 py-12 text-primary-foreground sm:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            Start with your next enquiry.
          </h2>
          <p className="mt-3 max-w-2xl opacity-90">
            Add one customer, one product and one follow-up. That is enough to
            see whether BizSakhi fits how you already work.
          </p>
          <Button asChild size="lg" variant="secondary" className="mt-6 h-12">
            <Link href="/signup">Create your free workspace</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
