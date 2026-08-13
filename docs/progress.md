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

- [ ] Dashboard metrics
- [ ] Contacts
- [ ] Pipeline
- [ ] Tasks and reminders cron
- [ ] Products and images
- [ ] Public catalogue
- [ ] Orders and payments
- [ ] Invoices

## Stage 5 — SaaS billing

- [ ] Plan definitions and entitlements
- [ ] Checkout and portal
- [ ] Webhooks with idempotency
- [ ] Usage counters and limit enforcement

## Stage 6 — AI tools

- [ ] Provider abstraction
- [ ] Smart Reply
- [ ] Content Generator
- [ ] Rate limiting, quotas, usage tracking

## Stage 7 — Communication integrations

- [ ] WhatsApp Cloud API foundation
- [ ] Instagram Messaging foundation
- [ ] Webhook verification and normalisation
- [ ] Setup-status screens

## Stage 8 — Production readiness

- [ ] Accessibility and responsive passes
- [ ] Security headers and CSP
- [ ] Test suite complete
- [ ] `docs/deployment.md`
- [ ] Vercel preview deployment + smoke tests

## Blockers

- Supabase project / Docker, Stripe test credentials, an AI provider key, Meta
  app credentials and a Vercel project link are required for the end-to-end
  Definition of Done. See `docs/implementation-plan.md`.
