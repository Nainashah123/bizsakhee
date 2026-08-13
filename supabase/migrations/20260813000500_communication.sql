-- BizSakhi: conversations, messages, attachments and templates.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  channel public.conversation_channel not null,
  -- Provider thread identifier (WhatsApp wa_id, Instagram thread id).
  external_thread_id text,
  status public.conversation_status not null default 'open',
  subject text,
  last_message_at timestamptz,
  -- WhatsApp only allows free-form replies within 24h of the customer's last
  -- message; this timestamp is what the UI checks before offering a send.
  customer_window_expires_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  assigned_to uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel, external_thread_id)
);

create index conversations_workspace_idx on public.conversations (workspace_id);
create index conversations_recent_idx
  on public.conversations (workspace_id, status, last_message_at desc);
create index conversations_contact_idx on public.conversations (contact_id);

create table public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  check (contact_id is not null or user_id is not null)
);

create index conversation_participants_workspace_idx
  on public.conversation_participants (workspace_id);
create index conversation_participants_conversation_idx
  on public.conversation_participants (conversation_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  status public.message_status not null default 'sent',
  body text,
  -- Provider message id; unique per workspace so replayed webhooks are no-ops.
  external_message_id text,
  template_name text,
  sent_by uuid references auth.users (id) on delete set null,
  ai_generation_id uuid,
  error_code text,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index messages_workspace_idx on public.messages (workspace_id);
create index messages_conversation_idx
  on public.messages (conversation_id, sent_at desc);
create unique index messages_external_id_key
  on public.messages (workspace_id, external_message_id)
  where external_message_id is not null;

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  byte_size integer check (byte_size > 0),
  file_name text,
  created_at timestamptz not null default now()
);

create index message_attachments_workspace_idx on public.message_attachments (workspace_id);
create index message_attachments_message_idx on public.message_attachments (message_id);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  channel public.conversation_channel not null default 'whatsapp',
  body text not null,
  -- Provider-approved template name, when the channel requires one.
  provider_template_name text,
  language text not null default 'en',
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, lower(name))
);

create index message_templates_workspace_idx on public.message_templates (workspace_id);

create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger messages_set_updated_at before update on public.messages
  for each row execute function public.set_updated_at();
create trigger message_templates_set_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();
