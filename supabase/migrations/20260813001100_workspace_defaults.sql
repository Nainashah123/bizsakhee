-- BizSakhi: defaults created with every workspace.
--
-- Subscription rows must never be writable from the browser (a client could
-- otherwise grant itself the Pro plan), so the free-plan row is created by a
-- trigger owned by the database rather than by application code.

create or replace function public.create_workspace_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscriptions (workspace_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (workspace_id) do nothing;

  insert into public.order_counters (workspace_id, last_number)
  values (new.id, 0)
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

create trigger workspaces_create_defaults
  after insert on public.workspaces
  for each row execute function public.create_workspace_defaults();

-- ---------------------------------------------------------------------------
-- Workspace slug allocation.
--
-- Runs as the definer so it can probe every workspace for a collision without
-- the caller being able to read other tenants' rows. It returns only a free
-- slug string, never any row data.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_workspace_slug(desired text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  base := lower(btrim(coalesce(desired, '')));
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');
  base := left(base, 40);

  if base = '' or length(base) < 2 then
    base := 'shop-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  candidate := base;

  while exists (select 1 from public.workspaces w where w.slug = candidate) loop
    suffix := suffix + 1;
    candidate := left(base, 40) || '-' || suffix::text;

    if suffix > 200 then
      candidate := base || '-' ||
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;
  end loop;

  return candidate;
end;
$$;

grant execute on function public.allocate_workspace_slug(text) to authenticated;
revoke execute on function public.allocate_workspace_slug(text) from anon;
revoke execute on function public.create_workspace_defaults() from anon, authenticated;
