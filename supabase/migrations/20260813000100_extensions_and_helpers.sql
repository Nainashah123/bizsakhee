-- BizSakhi: extensions, shared enums and helper functions.
-- Applied first; every later migration depends on these.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------

create type public.workspace_role as enum ('owner', 'admin', 'member');

create type public.invitation_status as enum (
  'pending', 'accepted', 'revoked', 'expired'
);

create type public.contact_status as enum ('active', 'archived');

create type public.channel_kind as enum (
  'whatsapp', 'instagram', 'phone', 'email', 'other'
);

create type public.task_status as enum ('open', 'completed', 'cancelled');
create type public.task_priority as enum ('low', 'normal', 'high');

create type public.product_status as enum ('draft', 'published', 'archived');
create type public.stock_status as enum ('in_stock', 'made_to_order', 'out_of_stock');

create type public.order_status as enum (
  'draft', 'confirmed', 'in_progress', 'ready', 'fulfilled', 'cancelled'
);
create type public.payment_status as enum (
  'unpaid', 'partially_paid', 'paid', 'refunded'
);
create type public.payment_method as enum (
  'cash', 'upi', 'bank_transfer', 'card', 'cod', 'other'
);

create type public.conversation_channel as enum ('whatsapp', 'instagram', 'manual');
create type public.conversation_status as enum ('open', 'snoozed', 'closed');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_status as enum (
  'pending', 'sent', 'delivered', 'read', 'failed'
);

create type public.ai_tool as enum ('smart_reply', 'content_generator');
create type public.content_draft_status as enum ('draft', 'approved', 'discarded');

create type public.integration_provider as enum ('whatsapp', 'instagram');
create type public.integration_status as enum (
  'not_configured', 'pending', 'connected', 'error', 'disconnected'
);

create type public.plan_key as enum ('free', 'starter', 'growth', 'pro');
create type public.subscription_status as enum (
  'active', 'trialing', 'past_due', 'canceled', 'incomplete',
  'incomplete_expired', 'unpaid', 'paused'
);

create type public.webhook_source as enum ('stripe', 'meta');
create type public.webhook_process_status as enum ('received', 'processed', 'failed');

-- ---------------------------------------------------------------------------
-- Timestamp maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenancy helpers
--
-- These are SECURITY DEFINER so that a policy on `contacts` can consult
-- `workspace_members` without re-entering that table's own RLS policy, which
-- would recurse. search_path is pinned so the definer rights cannot be abused
-- through a shadowed relation.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.workspace_role_of(target_workspace uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = target_workspace
    and m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_workspace_admin(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.workspace_role_of(target_workspace) in ('owner', 'admin');
$$;

create or replace function public.is_workspace_owner(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.workspace_role_of(target_workspace) = 'owner';
$$;

comment on function public.is_workspace_member(uuid) is
  'True when the current auth user belongs to the workspace. Used by RLS.';
