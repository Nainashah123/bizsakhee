# BizSakhi — setup and deployment runbook

Every command runs from the repository root. Secret values are never printed,
committed, or pasted into a chat log — they live in `.env.local` (gitignored)
locally and in Vercel environment variables in the cloud.

---

## 1. Local setup

```bash
pnpm install
cp .env.example .env.local     # then fill in the values below
pnpm dev
```

Until Supabase is configured the app deliberately renders a **"Setup required"**
screen on `/login`, `/signup`, `/onboarding` and `/dashboard` instead of
crashing. That is the expected state, not a bug.

Check what the running app thinks is configured:

```bash
curl http://localhost:3000/api/health
```

It reports `true`/`false` per integration and never echoes a value.

---

## 2. Supabase project

### 2.1 Create the project

1. <https://supabase.com/dashboard> → **New project**. Free tier is enough.
2. Choose a region close to your users (`ap-south-1` for India).
3. Save the **database password** shown at creation — the CLI asks for it when
   pushing migrations, and it cannot be read back later (only reset).

### 2.2 Collect the keys

Project Settings → **API Keys**:

| Dashboard value | Environment variable | Exposure |
| --- | --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | browser |
| `anon` / publishable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser — safe, RLS protects data |
| `service_role` / secret | `SUPABASE_SECRET_KEY` | **server only — bypasses RLS** |

Never give the secret key a `NEXT_PUBLIC_` prefix and never import it into a
Client Component. It is used only by webhooks and cron routes through
`createAdminClient()`.

### 2.3 Fill in `.env.local`

```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SECRET_KEY=<secret key>
AI_PROVIDER=mock
```

Restart `pnpm dev` afterwards — Next.js reads env files at boot.

### 2.4 Apply the migrations

```bash
pnpm exec supabase login                        # opens a browser once
pnpm exec supabase link --project-ref <project-ref>
pnpm exec supabase db push                      # prompts for the DB password
```

`db push` applies every file in `supabase/migrations/` in filename order:
extensions and enums, identity and tenancy, CRM, commerce, communication, AI,
integrations, SaaS operations, RLS policies, storage buckets and policies, and
workspace defaults.

Verify:

```bash
pnpm exec supabase migration list
```

### 2.5 Regenerate the database types

```bash
pnpm exec supabase gen types typescript --linked > lib/supabase/database.types.ts
pnpm typecheck
```

`lib/supabase/database.types.ts` is currently **hand-written** to match the
migrations, because generating it needs a live database. The command above
replaces it with the generated version. Any type error that appears afterwards
is a real drift between the hand-written types and the actual schema — fix the
code, not the generated file.

Once generated types exist, PostgREST embedded selects
(`select("a, other(b)")`) become usable again; until then the codebase queries
tables separately on purpose.

### 2.6 Storage buckets

`20260813001000_storage.sql` creates `avatars`, `product-images` and
`message-attachments` with their policies, so no dashboard clicking is needed.
Confirm under Storage → Buckets that all three exist and that
`message-attachments` is **not** public.

### 2.7 Local database instead of the cloud (optional)

Requires Docker Desktop.

```bash
pnpm db:start      # supabase start
pnpm db:reset      # re-applies every migration + supabase/seed.sql
pnpm db:types      # generates types from the local instance
```

`supabase start` prints local URLs and keys for `.env.local`. Seed data is for
development only and is never applied to a hosted project.

---

## 3. Stripe (billing)

Not required to run the app; billing shows a setup state until configured.

1. Stripe dashboard in **test mode** → Developers → API keys.
   - `STRIPE_SECRET_KEY` (`sk_test_…`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
     (`pk_test_…`).
2. Create one product per paid plan with monthly (and optionally annual)
   prices, then copy each price id into:
   - `STRIPE_STARTER_MONTHLY_PRICE_ID`, `STRIPE_STARTER_ANNUAL_PRICE_ID`
   - `STRIPE_GROWTH_MONTHLY_PRICE_ID`, `STRIPE_GROWTH_ANNUAL_PRICE_ID`
   - `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`

   Price ids are account-specific and are never hardcoded in the repository.
3. Webhooks. Locally:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

   Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`. In production add
   an endpoint at `https://<domain>/api/stripe/webhook` subscribed to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`.

The webhook — not the post-checkout redirect — is what activates a plan.

---

## 4. AI provider

```
AI_PROVIDER=anthropic          # or vercel-gateway, or mock
AI_MODEL=claude-sonnet-5
ANTHROPIC_API_KEY=...          # when AI_PROVIDER=anthropic
AI_GATEWAY_API_KEY=...         # when AI_PROVIDER=vercel-gateway
```

`mock` is for tests and CI: deterministic, no network, no key.

A Claude Code subscription credential must **not** be reused by the deployed
application. Production needs its own API or AI Gateway key.

---

## 5. Meta (WhatsApp Cloud API and Instagram)

Optional. Without these the integrations page reads "Setup required" and
WhatsApp deep links keep working.

1. <https://developers.facebook.com> → create an app → add WhatsApp and/or
   Instagram messaging.
2. Set `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
   (`https://<domain>/api/meta/oauth/callback`).
3. `META_VERIFY_TOKEN` is a string you invent; paste the same value into the
   Meta webhook configuration and into the env file.
4. Webhook callback URL: `https://<domain>/api/meta/webhook`.
5. Generate the token encryption key — per-workspace access tokens are
   encrypted before they reach Postgres:

   ```bash
   openssl rand -base64 32     # -> INTEGRATION_ENCRYPTION_KEY
   ```

Live messaging additionally requires Meta app review for the messaging
permissions. That is a human process and cannot be automated.

---

## 6. Cron

```bash
openssl rand -hex 32           # -> CRON_SECRET
```

`vercel.json` declares the schedule. Vercel sends the secret as a bearer token;
the endpoint compares it with a timing-safe comparison and refuses to run
unauthenticated. If `CRON_SECRET` is absent the endpoint returns 503 rather
than running open.

---

## 7. Vercel

```bash
vercel whoami                 # confirm the right account
vercel link                   # link this folder — do NOT create a duplicate project
vercel env ls                 # inspect what is already set
```

Add each variable per environment (`development`, `preview`, `production`):

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
```

Values are entered at the prompt, never as a command-line argument, so they do
not land in shell history.

`NEXT_PUBLIC_APP_URL` differs per environment — it must match the deployment
origin, or Supabase email links and Stripe redirects will point at the wrong
host.

### Preview deployment

```bash
pnpm verify                   # format:check, lint, typecheck, test, build
vercel deploy                 # preview URL
```

Smoke-test the preview before promoting:

1. `/api/health` reports the integrations you configured
2. Sign up → confirmation email → onboarding → dashboard
3. Create a contact, a product with an image, and an order
4. Record a payment and check the outstanding amount
5. Open the public catalogue and confirm draft products are invisible
6. Stripe test-mode checkout activates the plan **via the webhook**

### Production

```bash
vercel deploy --prod
```

Only after the preview smoke tests pass.

### Rollback

```bash
vercel ls                     # find the previous good deployment
vercel rollback <deployment-url>
```

Rolling back application code does **not** roll back database migrations.
Migrations are append-only: to undo a schema change, write a new migration that
reverses it and push that. Never edit or delete an applied migration.

---

## 8. Quality gate

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` starts its own dev server. It needs a configured Supabase
project — without one the auth journeys cannot run, and that is reported as a
blocker rather than a pass.
