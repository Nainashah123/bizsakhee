-- BizSakhi: subscriptions, usage metering, notifications and audit logs.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  plan public.plan_key not null default 'free',
  status public.subscription_status not null default 'active',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  interval text check (interval in ('month', 'year')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_ends_at timestamptz,
  -- Set by invoice.payment_failed so the UI can prompt a card update.
  payment_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_stripe_customer_idx on public.subscriptions (stripe_customer_id);
create index subscriptions_stripe_subscription_idx
  on public.subscriptions (stripe_subscription_id);

-- Metered features counted per calendar month. `period` is the first day of the
-- month in UTC so the unique key gives us one row per workspace/metric/month.
create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  metric text not null,
  period date not null,
  used integer not null default 0 check (used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, metric, period)
);

create index usage_counters_workspace_idx on public.usage_counters (workspace_id, period);

/*
 * Atomic quota consumption.
 *
 * The INSERT ... ON CONFLICT DO UPDATE with a WHERE clause makes the check and
 * the increment a single statement, so two concurrent AI requests cannot both
 * observe "1 remaining" and both succeed. Returns the new count, or NULL when
 * the limit would be exceeded.
 */
create or replace function public.consume_usage(
  target_workspace uuid,
  target_metric text,
  target_period date,
  max_allowed integer,
  amount integer default 1
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_used integer;
begin
  if amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into public.usage_counters (workspace_id, metric, period, used)
  values (target_workspace, target_metric, target_period, amount)
  on conflict (workspace_id, metric, period) do update
    set used = public.usage_counters.used + amount,
        updated_at = now()
    where public.usage_counters.used + amount <= max_allowed
  returning used into new_used;

  -- A fresh insert of `amount` can also exceed the limit (e.g. limit 0).
  if new_used is not null and new_used > max_allowed then
    update public.usage_counters
    set used = used - amount
    where workspace_id = target_workspace
      and metric = target_metric
      and period = target_period;
    return null;
  end if;

  return new_used;
end;
$$;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_workspace_idx on public.notifications (workspace_id, created_at desc);
create index notifications_user_unread_idx
  on public.notifications (user_id, read_at) where read_at is null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  -- Structured, redacted metadata only. Never full payloads or message bodies.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger usage_counters_set_updated_at before update on public.usage_counters
  for each row execute function public.set_updated_at();
