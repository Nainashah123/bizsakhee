-- BizSakhi: identity and tenancy.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_path text,
  phone text,
  preferred_language text not null default 'en',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  owner_id uuid not null references auth.users (id) on delete restrict,
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  country text not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  timezone text not null default 'Asia/Kolkata',
  is_catalogue_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);
create index workspace_members_workspace_id_idx on public.workspace_members (workspace_id);

create table public.business_profiles (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  business_name text not null,
  category text not null,
  description text,
  city text,
  country text not null default 'IN',
  primary_channel public.channel_kind not null default 'whatsapp',
  whatsapp_number text,
  instagram_handle text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  status public.invitation_status not null default 'pending',
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_invitations_workspace_idx
  on public.workspace_invitations (workspace_id, status);
create index workspace_invitations_email_idx
  on public.workspace_invitations (lower(email));

-- Keep `updated_at` honest on every table above.
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger workspace_members_set_updated_at before update on public.workspace_members
  for each row execute function public.set_updated_at();
create trigger business_profiles_set_updated_at before update on public.business_profiles
  for each row execute function public.set_updated_at();
create trigger workspace_invitations_set_updated_at before update on public.workspace_invitations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A profile row must exist for every auth user. Created by trigger so it is
-- present even for magic-link signups that never touch our onboarding code.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
