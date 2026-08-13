-- BizSakhi: row level security.
--
-- Model:
--   * Every tenant table carries workspace_id and is readable/writable only by
--     members of that workspace, checked through the SECURITY DEFINER helpers
--     so policies never recurse into workspace_members.
--   * Destructive or privileged tables (integrations, audit logs, webhook
--     events, subscriptions, usage counters) are read-only or invisible to the
--     browser and are written exclusively by trusted server code using the
--     service role, which bypasses RLS.
--   * The public catalogue is exposed through narrow anon SELECT policies that
--     require both a published product and an opted-in workspace.

-- ---------------------------------------------------------------------------
-- Standard tenant tables: full CRUD for any member of the workspace.
-- ---------------------------------------------------------------------------
do $$
declare
  target text;
  member_tables text[] := array[
    'contacts', 'contact_channels', 'tags', 'contact_tags',
    'pipelines', 'pipeline_stages', 'opportunities', 'tasks', 'notes',
    'products', 'product_variants', 'product_images',
    'orders', 'order_items', 'payments',
    'conversations', 'conversation_participants', 'messages',
    'message_attachments', 'message_templates',
    'content_drafts', 'notifications'
  ];
begin
  foreach target in array member_tables loop
    execute format('alter table public.%I enable row level security', target);

    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id))',
      target || '_select_member', target);

    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_workspace_member(workspace_id))',
      target || '_insert_member', target);

    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_workspace_member(workspace_id))
         with check (public.is_workspace_member(workspace_id))',
      target || '_update_member', target);

    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.is_workspace_member(workspace_id))',
      target || '_delete_member', target);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: a user sees and edits only their own profile row.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy profiles_insert_self on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

create policy profiles_update_self on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;

create policy workspaces_select_member on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));

-- Anyone may resolve a workspace that has opted its catalogue into public view.
create policy workspaces_select_public_catalogue on public.workspaces
  for select to anon, authenticated using (is_catalogue_public);

-- The creator must be the owner; membership is added by the same transaction.
create policy workspaces_insert_own on public.workspaces
  for insert to authenticated with check ((select auth.uid()) = owner_id);

create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated using (public.is_workspace_owner(id));

-- ---------------------------------------------------------------------------
-- workspace_members
--
-- The SELECT policy is deliberately expressed with the helper rather than a
-- sub-select on the same table, which would recurse.
-- ---------------------------------------------------------------------------
alter table public.workspace_members enable row level security;

create policy workspace_members_select_member on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Bootstrapping: the workspace owner inserts their own membership row. Every
-- other membership must be created by an admin.
create policy workspace_members_insert_bootstrap on public.workspace_members
  for insert to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.owner_id = (select auth.uid())
      )
    )
    or public.is_workspace_admin(workspace_id)
  );

create policy workspace_members_update_admin on public.workspace_members
  for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- Admins may remove members; owners cannot be removed by anyone but themselves.
create policy workspace_members_delete_admin on public.workspace_members
  for delete to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and (role <> 'owner' or user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- business_profiles: members read, admins write. Public for open catalogues.
-- ---------------------------------------------------------------------------
alter table public.business_profiles enable row level security;

create policy business_profiles_select_member on public.business_profiles
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy business_profiles_select_public on public.business_profiles
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.is_catalogue_public
    )
  );

create policy business_profiles_insert_admin on public.business_profiles
  for insert to authenticated with check (public.is_workspace_admin(workspace_id));

create policy business_profiles_update_admin on public.business_profiles
  for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- workspace_invitations: admins only. Acceptance happens in server code.
-- ---------------------------------------------------------------------------
alter table public.workspace_invitations enable row level security;

create policy workspace_invitations_select_admin on public.workspace_invitations
  for select to authenticated using (public.is_workspace_admin(workspace_id));

create policy workspace_invitations_insert_admin on public.workspace_invitations
  for insert to authenticated with check (public.is_workspace_admin(workspace_id));

create policy workspace_invitations_update_admin on public.workspace_invitations
  for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_invitations_delete_admin on public.workspace_invitations
  for delete to authenticated using (public.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Public catalogue: published products of an opted-in workspace only.
-- ---------------------------------------------------------------------------
create policy products_select_public on public.products
  for select to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.is_catalogue_public
    )
  );

create policy product_images_select_public on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      join public.workspaces w on w.id = p.workspace_id
      where p.id = product_id
        and p.status = 'published'
        and w.is_catalogue_public
    )
  );

create policy product_variants_select_public on public.product_variants
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      join public.workspaces w on w.id = p.workspace_id
      where p.id = product_id
        and p.status = 'published'
        and w.is_catalogue_public
    )
  );

-- ---------------------------------------------------------------------------
-- ai_generations: members read and record their own runs; never updated.
-- ---------------------------------------------------------------------------
alter table public.ai_generations enable row level security;

create policy ai_generations_select_member on public.ai_generations
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy ai_generations_insert_member on public.ai_generations
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and (user_id is null or user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Read-only-to-the-browser tables. Writes happen only through trusted server
-- code using the service role, which is exempt from RLS.
-- ---------------------------------------------------------------------------
alter table public.subscriptions enable row level security;

create policy subscriptions_select_member on public.subscriptions
  for select to authenticated using (public.is_workspace_member(workspace_id));

alter table public.usage_counters enable row level security;

create policy usage_counters_select_member on public.usage_counters
  for select to authenticated using (public.is_workspace_member(workspace_id));

alter table public.audit_logs enable row level security;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated using (public.is_workspace_admin(workspace_id));

alter table public.integrations enable row level security;

-- Admins can see the connection status. Tokens are stored encrypted and the
-- application never selects the ciphertext columns for the browser.
create policy integrations_select_admin on public.integrations
  for select to authenticated using (public.is_workspace_admin(workspace_id));

alter table public.integration_events enable row level security;

create policy integration_events_select_admin on public.integration_events
  for select to authenticated using (public.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Tables with no policies at all: RLS on, nothing granted to any browser role.
-- ---------------------------------------------------------------------------
alter table public.webhook_events enable row level security;
alter table public.order_counters enable row level security;

revoke all on table public.webhook_events from anon, authenticated;
revoke all on table public.order_counters from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileged helpers are not callable directly from the browser. The trigger
-- wrappers become SECURITY DEFINER so they can still reach them while running
-- on behalf of an ordinary member.
-- ---------------------------------------------------------------------------
alter function public.assign_order_number() security definer
  set search_path = public, pg_temp;
alter function public.payments_touch_order() security definer
  set search_path = public, pg_temp;

revoke execute on function public.consume_usage(uuid, text, date, integer, integer)
  from anon, authenticated;
revoke execute on function public.next_order_number(uuid) from anon, authenticated;
revoke execute on function public.recalculate_order_payment(uuid) from anon, authenticated;
