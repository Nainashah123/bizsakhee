# Ralph iteration log

The autonomous loop is driven by the official `ralph-loop` plugin from the
`anthropics/claude-code` marketplace. Each entry records: objective, files
changed, commands executed, actual results, blockers and next priority.

---

## Iteration 0 — manual (pre-loop bootstrap)

**Objective.** Assess the repository, establish architecture and complete
Stage 1 (foundation), then begin Stage 2 (database and security).

**Repository state found.** Empty apart from a `.remember/` directory. No git
repository, no `package.json`, no `CLAUDE.md`.

**Files changed.** Full Stage 1 scaffold (see commit `Stage 1: BizSakhi
foundation`) plus `supabase/config.toml` and seven migrations under
`supabase/migrations/`.

**Commands executed and actual results.**

| Command                                     | Result                                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| `pnpm install`                              | pass                                                        |
| `pnpm dlx shadcn@latest init --preset nova` | pass                                                        |
| `pnpm format`                               | pass                                                        |
| `pnpm lint`                                 | pass (after ignoring `.remember/`, escaping an entity)      |
| `pnpm typecheck`                            | pass (after replacing build-generated `LayoutProps`)        |
| `pnpm test`                                 | pass — 11 tests, 1 file                                     |
| `pnpm build`                                | pass — routes `/` and `/_not-found` prerendered             |
| `vercel whoami`                             | `codingmonk-yt`; this folder is **not** linked to a project |
| `docker info`                               | **not installed**                                           |
| `supabase db reset`                         | **not run** — requires Docker or a linked project           |

**Notable fix.** `toMinorUnits(1.005)` returned 100 paise because
`1.005 * 100` is `100.4999…` in binary floating point. Replaced the multiply
with digit-string shifting and half-up rounding; the regression test now pins
this behaviour.

**Blockers.**

1. The `ralph-loop` plugin is not installed, so `/ralph-loop` is unavailable.
   The official marketplace lists the package as `ralph-loop`, not
   `ralph-wiggum`.
2. No Docker and no Supabase project, so the migrations in this iteration are
   **written but unapplied and unverified**. They must not be reported as
   working until `supabase db reset` (or `supabase db push`) succeeds.

**Next priority.** Apply the migrations against a real Postgres, regenerate
`lib/supabase/database.types.ts`, then write the cross-workspace isolation
tests before starting Stage 3 (authentication and onboarding).

---

## Iteration 1 — manual

**Objective.** Stage 3: authentication, onboarding, role authorisation and the
dashboard shell.

**Files changed.** `lib/auth/{session,redirect}.ts`, `lib/permissions/`,
`lib/rate-limit/`, `lib/validation/{auth,form,onboarding,workspace}.ts`,
`lib/contacts/normalize.ts`, `lib/supabase/database.types.ts`,
`features/{auth,onboarding,workspace,dashboard}/`, `components/{auth,dashboard,
onboarding,settings}/`, `app/(auth)/`, `app/(dashboard)/`, `app/onboarding/`,
`app/auth/callback/`, `app/api/health/`, `app/{error,not-found}.tsx`,
`supabase/migrations/20260813001100_workspace_defaults.sql`, plus three test
files.

**Commands executed and actual results.**

| Command          | Result                   |
| ---------------- | ------------------------ |
| `pnpm test`      | pass — 34 tests, 4 files |
| `pnpm lint`      | pass                     |
| `pnpm typecheck` | pass                     |
| `pnpm build`     | pass — 11 routes         |

**Decisions worth recording.**

- `lib/supabase/database.types.ts` is hand-written for now. The generator needs
  a running Postgres; without one, every table write was typed `never` and the
  build could not have been trusted. Consequence: PostgREST embedded selects
  are banned until real types exist, because they need generated
  `Relationships` metadata. `getSessionContext` therefore issues two queries
  instead of one join.
- Subscription rows are created by a database trigger on `workspaces`, not by
  application code, so no browser-reachable path can grant a paid plan.
- Navigation lists only routes that exist. Modules arriving in Stage 4 sit in
  `PLANNED_NAV_ITEMS` rather than rendering links to 404s.

**Blockers.** Unchanged: no Docker and no Supabase project, so no migration has
been applied and no auth flow has been exercised against a real backend. The
`ralph-loop` plugin is still not installed.

**Next priority.** Stage 4 - contacts first (create, list, search, duplicate
detection, timeline), since orders and tasks both hang off it.
