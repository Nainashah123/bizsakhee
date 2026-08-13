-- BizSakhi: CRM - contacts, channels, tags, pipelines, opportunities, tasks, notes.

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  -- Normalised digits-only phone (E.164 without '+'), used for deduplication.
  phone_normalized text check (phone_normalized ~ '^[0-9]{6,15}$'),
  phone_display text,
  email text,
  email_normalized text generated always as (lower(nullif(btrim(email), ''))) stored,
  city text,
  lead_source text,
  status public.contact_status not null default 'active',
  assigned_to uuid references auth.users (id) on delete set null,
  next_follow_up_at timestamptz,
  last_contacted_at timestamptz,
  notes_summary text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_workspace_idx on public.contacts (workspace_id);
create index contacts_workspace_name_idx
  on public.contacts (workspace_id, lower(full_name));
create index contacts_workspace_status_idx
  on public.contacts (workspace_id, status);
create index contacts_follow_up_idx
  on public.contacts (workspace_id, next_follow_up_at)
  where next_follow_up_at is not null;
-- Duplicate detection: the same phone or email may not appear twice per workspace.
create unique index contacts_workspace_phone_key
  on public.contacts (workspace_id, phone_normalized)
  where phone_normalized is not null;
create unique index contacts_workspace_email_key
  on public.contacts (workspace_id, email_normalized)
  where email_normalized is not null;

create table public.contact_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  kind public.channel_kind not null,
  handle text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, kind, handle)
);

create index contact_channels_workspace_idx on public.contact_channels (workspace_id);
create index contact_channels_lookup_idx
  on public.contact_channels (workspace_id, kind, handle);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default 'plum',
  created_at timestamptz not null default now(),
  unique (workspace_id, lower(name))
);

create index tags_workspace_idx on public.tags (workspace_id);

create table public.contact_tags (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create index contact_tags_workspace_idx on public.contact_tags (workspace_id);
create index contact_tags_tag_idx on public.contact_tags (tag_id);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pipelines_workspace_idx on public.pipelines (workspace_id);
create unique index pipelines_one_default_per_workspace
  on public.pipelines (workspace_id) where is_default;

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  name text not null,
  position integer not null check (position >= 0),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, position),
  check (not (is_won and is_lost))
);

create index pipeline_stages_workspace_idx on public.pipeline_stages (workspace_id);
create index pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id, position);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages (id) on delete restrict,
  contact_id uuid references public.contacts (id) on delete set null,
  title text not null,
  value_minor bigint not null default 0 check (value_minor >= 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  expected_close_on date,
  assigned_to uuid references auth.users (id) on delete set null,
  position integer not null default 0,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_workspace_idx on public.opportunities (workspace_id);
create index opportunities_stage_idx on public.opportunities (stage_id, position);
create index opportunities_contact_idx on public.opportunities (contact_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text,
  status public.task_status not null default 'open',
  priority public.task_priority not null default 'normal',
  due_at timestamptz,
  contact_id uuid references public.contacts (id) on delete set null,
  order_id uuid,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  assigned_to uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_workspace_idx on public.tasks (workspace_id);
create index tasks_due_idx on public.tasks (workspace_id, status, due_at);
create index tasks_assignee_idx on public.tasks (workspace_id, assigned_to, status);
create index tasks_contact_idx on public.tasks (contact_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  opportunity_id uuid references public.opportunities (id) on delete cascade,
  body text not null check (char_length(btrim(body)) > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contact_id is not null or opportunity_id is not null)
);

create index notes_workspace_idx on public.notes (workspace_id);
create index notes_contact_idx on public.notes (contact_id, created_at desc);

create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger contact_channels_set_updated_at before update on public.contact_channels
  for each row execute function public.set_updated_at();
create trigger pipelines_set_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();
create trigger pipeline_stages_set_updated_at before update on public.pipeline_stages
  for each row execute function public.set_updated_at();
create trigger opportunities_set_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();
