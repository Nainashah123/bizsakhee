# BizSakhi — Progress

Legend: `[x]` done and verified · `[~]` in progress · `[ ]` not started

## Stage 1 — Foundation

- [x] Repository assessment (empty apart from `.remember/`, no git history)
- [x] Git repository initialised
- [x] Next.js 16.3 + React 19.2 + TypeScript strict + Tailwind 4 scaffold
- [x] pnpm dependency set installed
- [x] shadcn/ui initialised and core primitives generated
- [x] BizSakhi brand theme tokens (ivory / plum / violet, lime success)
- [x] `CLAUDE.md`, `AGENTS.md`, `docs/implementation-plan.md`, `docs/progress.md`
- [x] `.env.example` with every documented variable
- [x] Zod environment validation (`lib/env.ts`)
- [x] Supabase browser / server / admin clients
- [x] Session proxy with dashboard route protection (`proxy.ts`)
- [x] Structured logger and typed `Result`
- [x] Prettier, ESLint, Vitest, Playwright configuration
- [x] Root layout, marketing shell, homepage
- [x] Stage 1 quality gate green (format, lint, typecheck, 11 tests, build)
- [ ] Auth and dashboard shells (Stage 3)

## Stage 2 — Database and security

Migrations below are **written but not yet applied** — no Docker and no linked
Supabase project, so nothing here is verified.

- [~] Migrations: extensions, enums, tenancy helpers
- [~] Migrations: identity and tenancy
- [~] Migrations: CRM
- [~] Migrations: commerce (server-side order numbering, derived payment status)
- [~] Migrations: communication
- [~] Migrations: AI and content
- [~] Migrations: integrations and webhook events
- [~] Migrations: SaaS operations (atomic `consume_usage`)
- [~] RLS policies + non-recursive security helper functions
- [~] Storage buckets and policies
- [~] Workspace defaults trigger + slug allocation function
- [ ] Applied successfully against Postgres (`supabase db reset`)
- [~] Database types (hand-written to match the migrations; replaced by
  `pnpm db:types` once a database exists)
- [ ] Seed data (development only)
- [ ] Tenant isolation tests

## Stage 3 — Authentication and onboarding

Code complete and passing the quality gate. Behaviour against a live Supabase
project is still unverified (no database yet).

- [x] Sign up, sign in, magic link, email confirmation callback, forgot and
      reset password, sign out
- [x] Safe redirect allowlist (`lib/auth/redirect.ts`) + 6 tests
- [x] Generic auth errors and per-email/IP rate limiting
- [x] Onboarding wizard (3 steps) creating workspace, membership, business
      profile, default pipeline and stages
- [x] Optional demo data, only on explicit opt-in
- [x] Role-aware server guards (`requireWorkspace`, `requireCapability`)
- [x] Central role/capability matrix + 8 tests
- [x] Dashboard shell: sidebar, mobile bottom nav, user menu, skip link
- [x] Overview page reading live workspace metrics, with empty state
- [x] Settings page (workspace + business + profile), admin-gated
- [x] Error boundary, not-found page, dashboard loading skeleton
- [x] `/api/health` configuration probe
- [ ] Verified end to end against a live Supabase project

## Stage 4 — Core business system

- [x] Dashboard metrics
- [x] Contacts (search, filters, tags, notes, channels, CSV import/export,
      duplicate detection on normalised phone/email, timeline)
- [x] Pipeline with an accessible "move to stage" control, not drag-only
- [x] Tasks, timezone-correct due buckets, CRON_SECRET-protected reminders
- [x] Products, variants, images with validated Storage uploads
- [x] Public catalogue at /store/[slug]; drafts never exposed
- [x] Orders with server-computed totals and payments
- [x] Printable invoice and token-shared public invoice

## Stage 5 — SaaS billing

- [x] Plan definitions and entitlements (Free/Starter/Growth/Pro)
- [x] Stripe Checkout and customer portal, owner-gated
- [x] Webhooks for the six required events, signature-verified and idempotent
- [x] Usage counters and server-side limit enforcement, incl. the CSV path
- [x] Billing page and public /pricing, honest when Stripe is unconfigured
- [ ] Verified against Stripe test mode (needs keys + 6 price ids)

## Stage 6 — AI tools

- [x] Provider abstraction (anthropic | vercel-gateway | mock)
- [x] Smart Reply and Marketing Content, Zod-validated structured output
- [x] Rate limiting, atomic monthly quota, usage tracking
- [x] Draft-only: nothing is sent or stored without explicit approval
- [ ] Verified against a real provider key (mock provider covers tests)

## Stage 7 — Communication integrations

- [x] AES-256-GCM encryption for per-workspace tokens
- [x] Meta webhook HMAC verification over the raw body, failing closed
- [x] Channels screen: deployment config outranks any stored row, so a stale
      row can never render "Connected"
- [~] WhatsApp/Instagram adapters, OAuth and webhook routes (in progress)
- [ ] Verified against a real Meta app (needs credentials + app review)

## Stage 8 — Production readiness

- [x] Security headers and a nonce-based CSP, verified in a browser to not
      break hydration or Server Actions
- [x] Error boundary, not-found, loading skeletons, /api/health
- [x] Playwright suite: public pages, auth guards, open-redirect refusal,
      security headers, on desktop and mobile viewports
- [x] `docs/deployment.md`
- [ ] Accessibility audit pass
- [ ] Vercel preview deployment + smoke tests (needs project link)
- [ ] Cross-workspace isolation test (needs SUPABASE_SECRET_KEY)

## Blockers

All code-level work is done and green. What remains needs credentials or a
human action:

1. **SUPABASE_SECRET_KEY** — blocks the cron reminders, Stripe webhooks, the
   public invoice lookup, and the cross-workspace isolation test. The E2E
   journey provisions its own confirmed user the moment this exists.
2. **Email confirmation for the test account** — blocks driving
   login -> onboarding -> dashboard in a browser, so Stages 3-7 remain
   "code complete and unit-tested" rather than "verified end to end".
3. **Stripe test keys + 6 price ids** — blocks verifying a real checkout and a
   real webhook activation.
4. **Vercel project link** — blocks the preview deployment and its smoke tests.
5. **Meta app credentials** — optional. The product works without them and the
   Channels screen says so honestly.
