# BizSakhi — Architecture, Conventions and Commands

BizSakhi is a mobile-first business operating system for women running small
businesses through WhatsApp, Instagram and personal networks: contacts, leads,
orders, payments, follow-ups, products and marketing content.

One deployable full-stack **Next.js 16 (App Router)** application on Vercel.
There is **no separate backend service**. Route Handlers, Server Actions and
Server Components are the backend; Supabase provides Postgres, Auth and Storage.

## Commands

| Task                   | Command                             |
| ---------------------- | ----------------------------------- |
| Dev server             | `pnpm dev`                          |
| Production build       | `pnpm build`                        |
| Lint                   | `pnpm lint`                         |
| Types                  | `pnpm typecheck`                    |
| Unit/integration tests | `pnpm test`                         |
| E2E tests              | `pnpm test:e2e`                     |
| Format                 | `pnpm format` / `pnpm format:check` |
| Local database         | `pnpm db:start` (Docker required)   |
| Reset + migrate + seed | `pnpm db:reset`                     |
| Regenerate DB types    | `pnpm db:types`                     |
| Full quality gate      | `pnpm verify`                       |

Quality gate before declaring any milestone complete:
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`,
then `pnpm test:e2e`.

## Directory map

```
app/
  (marketing)/       public site: /, /features, /pricing, /industries, legal
  (auth)/            /login, /signup, /forgot-password, /reset-password
  (dashboard)/       authenticated app under /dashboard/*
  store/[slug]/      public catalogue
  invoice/[token]/   public invoice by unguessable token
  api/               webhooks, cron, streaming AI, public APIs
components/
  ui/                shadcn/ui primitives (generated — edit sparingly)
  <domain>/          dashboard, contacts, orders, products, billing, ai
features/            feature-scoped composition (server actions + views)
lib/
  auth/              session + workspace membership resolution
  supabase/          browser/server/admin clients, generated types
  stripe/            client, plan→price mapping, webhook handlers
  ai/                provider abstraction, prompts, schemas
  permissions/       roles and capability checks
  plans/             plan definitions and entitlements
  validation/        Zod schemas shared by forms and server code
  storage/           Supabase Storage helpers, upload validation
  integrations/      Meta (WhatsApp/Instagram) adapters, token crypto
  rate-limit/        request throttling
supabase/
  migrations/        versioned SQL, applied in filename order
  seed.sql           local development data only
tests/
  unit/ integration/ e2e/
docs/
```

## Non-negotiable rules

1. **Tenancy.** Every business row carries `workspace_id`. Never trust a
   workspace id sent by the browser — resolve membership server-side via
   `lib/auth` on every protected operation. RLS is enabled on all tenant tables
   and is the second line of defence, not the only one.
2. **Auth truth.** Use `supabase.auth.getUser()` (validates with Supabase) for
   authorization decisions. Never authorize from `getSession()` cookie payload.
3. **Money.** Integer minor units (paise) plus an ISO currency code. No floats.
   Order totals are always recomputed on the server from server-side prices.
4. **Validation.** Zod at every boundary: Server Actions, Route Handlers,
   webhook payloads, AI outputs, CSV imports.
5. **Errors.** Services return `Result<T>` from `lib/result.ts` rather than
   throwing for expected failures. Never leak database errors to the client.
6. **Secrets.** `SUPABASE_SECRET_KEY`, Stripe, AI and Meta keys are server-only.
   Nothing secret may be read in a Client Component or prefixed `NEXT_PUBLIC_`.
   Never log full webhook payloads or customer message bodies.
7. **Webhooks.** Verify signatures, then record the external event id in
   `webhook_events` and process idempotently. Webhook state — not a success
   redirect — is the source of truth for subscriptions.
8. **Runtime.** Node.js runtime for Stripe webhooks, crypto, file processing.
   Edge only with a measured benefit and compatible dependencies.
9. **Components.** Server Components load data; Client Components only for
   interaction. Business logic lives in `lib/` or `features/`, never inline in a
   component.
10. **Honesty.** No fake buttons, dead forms, placeholder routes, or a
    "Connected" badge for an integration that is not configured. Missing
    credentials render an explicit "Setup required" state with a checklist.

## UI conventions

- Mobile-first. Bottom navigation on small screens, sidebar from `lg`.
- Brand tokens live in `app/globals.css`: warm ivory surfaces, deep plum
  primary, violet accent. Lime = success only; red = error/destructive only.
- Use semantic tokens (`bg-card`, `text-muted-foreground`, `text-success`),
  never raw hex.
- Lucide icons for UI affordances — never emoji as icons.
- Every list view ships a loading skeleton, an empty state and an error state.
- Accessibility: labelled inputs, visible focus rings, WCAG AA contrast,
  keyboard paths for anything drag-and-drop, `prefers-reduced-motion` honoured.

## Database conventions

- UUID primary keys (`gen_random_uuid()`), `created_at`/`updated_at` timestamptz.
- Statuses as Postgres enums.
- Migrations are append-only: never edit an applied migration; add a new one.
- Regenerate `lib/supabase/database.types.ts` after every schema change.
- Index `workspace_id` on every tenant table, plus the documented lookup paths.

## Testing conventions

- Unit tests for pure logic (money, entitlements, permissions, normalisation,
  AI schema validation, Stripe event mapping).
- Integration tests for auth guards, cross-workspace isolation and webhook
  idempotency. Mock only at external service boundaries — never mock our own
  business logic.
- Playwright covers the critical user journeys end to end.
