-- BizSakhi: channel integrations and webhook bookkeeping.
--
-- Access tokens are encrypted by the application before they reach Postgres
-- (AES-256-GCM with INTEGRATION_ENCRYPTION_KEY). The database only ever sees
-- ciphertext, and RLS keeps these rows out of the browser entirely.

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'not_configured',
  -- Provider identifiers that are safe to show in the UI.
  external_account_id text,
  display_name text,
  phone_number_id text,
  waba_id text,
  instagram_user_id text,
  scopes text[] not null default '{}',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  last_error text,
  connected_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create index integrations_workspace_idx on public.integrations (workspace_id);
create index integrations_phone_number_idx
  on public.integrations (phone_number_id) where phone_number_id is not null;
create index integrations_instagram_user_idx
  on public.integrations (instagram_user_id) where instagram_user_id is not null;

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete cascade,
  provider public.integration_provider not null,
  event_type text not null,
  -- Redacted, structured summary. Full payloads with personal data are not kept.
  summary jsonb not null default '{}'::jsonb,
  succeeded boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

create index integration_events_workspace_idx
  on public.integration_events (workspace_id, created_at desc);
create index integration_events_integration_idx
  on public.integration_events (integration_id, created_at desc);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source public.webhook_source not null,
  -- Provider event id. The unique constraint is what makes replay a no-op.
  external_event_id text not null,
  event_type text not null,
  status public.webhook_process_status not null default 'received',
  workspace_id uuid references public.workspaces (id) on delete set null,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, external_event_id)
);

create index webhook_events_status_idx on public.webhook_events (source, status, received_at desc);

create trigger integrations_set_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();
