-- Platform administrators: the people who operate BizSakhi itself.
--
-- This is a different axis from workspace roles. An owner/admin/member is
-- powerful inside one business and invisible to every other; a platform admin
-- runs the software and necessarily sees across businesses.
--
-- Because that crosses the tenancy boundary the whole product rests on, the
-- table is deliberately unreachable from a browser:
--
--   * RLS is enabled and NO policy is created for anon or authenticated, so
--     the table reads as empty and rejects every write from a session client
--   * privileges are revoked outright as a second line of defence
--   * membership is therefore only grantable by someone with the service role
--     or direct database access - never by a seller, and never by a platform
--     admin acting through the app
--
-- Every read of another business's data through the admin area is written to
-- audit_logs by the application. Being able to look is not the same as looking
-- unobserved.

create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  -- Kept for display in the admin area so it need not join auth.users.
  email text not null,
  note text,
  created_at timestamptz not null default now()
);

create index platform_admins_user_id_idx on public.platform_admins (user_id);

alter table public.platform_admins enable row level security;

revoke all on table public.platform_admins from anon, authenticated;

comment on table public.platform_admins is
  'Operators of the platform. Never writable from a browser; grant via the service role only.';

-- ---------------------------------------------------------------------------
-- Seed the first operator.
--
-- Matched by email against an existing account. If that account does not exist
-- yet the insert is simply skipped rather than failing the migration, and the
-- row can be added later.
-- ---------------------------------------------------------------------------
insert into public.platform_admins (user_id, email, note)
select id, email, 'Founding operator, seeded by migration.'
from auth.users
where lower(email) = 'nainashah2024@gmail.com'
on conflict (user_id) do nothing;
