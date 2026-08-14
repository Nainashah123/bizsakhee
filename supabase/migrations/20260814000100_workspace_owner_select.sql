-- Let a workspace owner read their own workspace.
--
-- Creating the first workspace was impossible. The insert is
-- `insert ... returning id, slug`, and RETURNING is subject to the SELECT
-- policies, of which there were only two:
--
--   workspaces_select_member            - needs a workspace_members row
--   workspaces_select_public_catalogue  - needs is_catalogue_public
--
-- At the moment of creation neither holds: membership cannot exist yet because
-- it references the workspace, and a new workspace is private by default. So
-- the row was inserted and then the read back was refused with 42501, which
-- PostgREST surfaces as a failed insert.
--
-- The same gap broke the very next statement. The bootstrap policy on
-- workspace_members asks `exists (select 1 from public.workspaces w where
-- w.id = workspace_id and w.owner_id = auth.uid())`, and that subquery is
-- itself subject to workspaces' SELECT policies - so it could never be
-- satisfied either.
--
-- Ownership is recorded on the row itself and does not depend on membership,
-- so the owner is entitled to see it. This also covers the case where an
-- owner's membership row is removed: they keep access to the workspace they
-- own rather than being locked out of it.

create policy workspaces_select_owner on public.workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()));
