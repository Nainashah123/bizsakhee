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

| Command | Result |
| --- | --- |
| `pnpm install` | pass |
| `pnpm dlx shadcn@latest init --preset nova` | pass |
| `pnpm format` | pass |
| `pnpm lint` | pass (after ignoring `.remember/`, escaping an entity) |
| `pnpm typecheck` | pass (after replacing build-generated `LayoutProps`) |
| `pnpm test` | pass — 11 tests, 1 file |
| `pnpm build` | pass — routes `/` and `/_not-found` prerendered |
| `vercel whoami` | `codingmonk-yt`; this folder is **not** linked to a project |
| `docker info` | **not installed** |
| `supabase db reset` | **not run** — requires Docker or a linked project |

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
