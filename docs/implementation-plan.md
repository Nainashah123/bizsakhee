# BizSakhi — Implementation Plan

Single deployable Next.js 16 App Router application (modular monolith) on
Vercel, backed by Supabase Postgres/Auth/Storage, Stripe Billing and the Vercel
AI SDK. Conventions and commands: [CLAUDE.md](../CLAUDE.md).

## Stage 1 — Foundation

Next.js 16 + TypeScript strict + Tailwind 4 + shadcn/ui, brand theme tokens,
Zod environment validation, Supabase browser/server/admin clients, session
proxy, structured logger, typed `Result`, Prettier/ESLint/Vitest/Playwright
wiring, base layouts and documentation.

**Acceptance:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
and `pnpm build` all pass; brand theme renders; docs exist.

## Stage 2 — Database and security

Versioned SQL migrations for identity/tenancy, CRM, commerce, communication, AI,
integrations and SaaS operations tables. RLS on every tenant table using
non-recursive `SECURITY DEFINER` helpers over `workspace_members`. Storage
buckets `avatars`, `product-images`, `message-attachments` with policies.
Generated database types. Development seed data.

**Acceptance:** `supabase db reset` applies cleanly; generated types compile;
automated tests prove workspace A cannot read workspace B's rows; private
objects are not reachable by a predictable URL.

## Stage 3 — Authentication and onboarding

Email+password, magic link, email verification, forgot/reset password, sign out,
safe redirect allowlist. Onboarding creates the profile, workspace, business
profile, membership and a default pipeline; demo data only on explicit opt-in.
Role-aware server guards (`owner` / `admin` / `member`).

**Acceptance:** a new user registers, verifies, onboards and lands on a
dashboard scoped to their own workspace; unauthenticated dashboard access
redirects to `/login?redirectTo=…`; role checks are enforced server-side.

## Stage 4 — Core business system

Dashboard metrics with date ranges and empty states. Contacts (search, filters,
tags, notes, channels, CSV import/export, duplicate detection, timeline).
Pipeline with accessible stage movement. Tasks and follow-ups plus a
`CRON_SECRET`-protected reminders endpoint. Products with variants and images,
draft/published, public catalogue at `/store/[workspaceSlug]`. Orders with
server-calculated totals, payments, printable and token-shared invoices.

**Acceptance:** each module supports full create/read/update/archive from the
UI against real data; totals recompute server-side; unpublished products are
invisible publicly; invoice tokens are unguessable.

## Stage 5 — SaaS billing

Central plan definitions (Free / Starter ₹299 / Growth ₹699 / Pro ₹1,499),
Stripe customer creation, hosted Checkout, customer portal, webhook processing
for the six required events with signature verification and idempotency,
server-side entitlement checks and atomic usage counters, graceful downgrade.

**Acceptance:** a test-mode checkout activates a plan **via webhook**; replaying
a webhook changes nothing; exceeding a limit is blocked server-side with a clear
upgrade path; downgrade preserves existing records.

## Stage 6 — AI tools

Provider abstraction (`anthropic` | `vercel-gateway` | `mock`), Smart Reply and
Marketing Content Generator with Zod-validated structured output, rate limiting,
monthly quota enforcement, timeouts, safe retries, usage tracking, explicit
AI-generated labelling and user confirmation before sending or storing.

**Acceptance:** both tools return schema-valid output with the mock provider in
tests and with a real key when configured; quota and rate limits are enforced
server-side; no provider key reaches the browser.

## Stage 7 — Communication integrations

WhatsApp Cloud API and Instagram Messaging foundations: Meta OAuth flow, webhook
verification and signature checking, normalised inbound messages, outbound
services, delivery/read status, templates, 24-hour window awareness, encrypted
per-workspace tokens, idempotent event processing, human approval before sending
AI replies.

**Acceptance:** without Meta credentials the integrations page reads "Setup
required" with a checklist and the rest of the product is unaffected; WhatsApp
deep links keep working; webhook verification and signature checks are tested.

## Stage 8 — Production readiness

Accessibility and responsive passes, security headers and CSP, rate limits,
audit logging, health endpoint, error boundaries and not-found pages, full test
suite, deployment documentation, Vercel preview deployment and smoke tests.

**Acceptance:** the full quality gate passes and a preview deployment serves the
critical journeys.

## Human-provided credentials

The application is built to run without these, showing honest setup states, but
the Definition of Done requires them:

| Need                                        | Used for                   | Blocking                          |
| ------------------------------------------- | -------------------------- | --------------------------------- |
| Supabase project (or Docker for local)      | database, auth, storage    | Stages 2+ end-to-end verification |
| Stripe test keys + 6 price ids              | billing                    | Stage 5 verification              |
| `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY` | AI tools in production     | Stage 6 production verification   |
| Meta app credentials                        | WhatsApp/Instagram         | Stage 7 live messaging only       |
| Vercel project link                         | preview/production deploys | Stage 8                           |
