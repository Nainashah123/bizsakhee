-- BizSakhi: storage buckets and object policies.
--
-- Path conventions (the first path segment is always the tenant/user id, which
-- is what the policies below authorise against):
--   avatars/<user_id>/<random>.<ext>
--   product-images/<workspace_id>/<product_id>/<random>.<ext>
--   message-attachments/<workspace_id>/<conversation_id>/<random>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'avatars', 'avatars', true, 2 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  ),
  (
    'product-images', 'product-images', true, 5 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  ),
  (
    'message-attachments', 'message-attachments', false, 10 * 1024 * 1024,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'application/pdf', 'audio/mpeg', 'audio/ogg', 'video/mp4'
    ]
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Casting a path segment straight to uuid would raise instead of denying when
-- the path is malformed; this returns NULL, which fails the membership check.
create or replace function public.safe_uuid(value text)
returns uuid
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then value::uuid
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- avatars: world readable, writable only by the owning user.
-- ---------------------------------------------------------------------------
create policy "avatars are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

create policy "users manage their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- product-images: readable by anyone (the catalogue is a public page), but
-- only members of the owning workspace may upload, replace or delete.
-- ---------------------------------------------------------------------------
create policy "product images are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');

create policy "workspace members upload product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "workspace members update product images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'product-images'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "workspace members delete product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  );

-- ---------------------------------------------------------------------------
-- message-attachments: private bucket. Reads require a signed URL issued by
-- server code; direct listing is limited to workspace members.
-- ---------------------------------------------------------------------------
create policy "workspace members read message attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "workspace members upload message attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  );

create policy "workspace members delete message attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and public.is_workspace_member(public.safe_uuid((storage.foldername(name))[1]))
  );
