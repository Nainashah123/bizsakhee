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
- [ ] Applied successfully against Postgres (`supabase db reset`)
- [ ] Generated database types
- [ ] Seed data (development only)
- [ ] Tenant isolation tests

## Stage 3 — Authentication and onboarding

- [ ] Sign up / sign in / magic link / verify / forgot / reset / sign out
- [ ] Safe redirect allowlist
- [ ] Onboarding wizard and workspace creation
- [ ] Default pipeline creation, optional demo data
- [ ] Role-aware server guards

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
