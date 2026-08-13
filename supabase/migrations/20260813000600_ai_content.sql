-- BizSakhi: AI generations and content drafts.

create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  tool public.ai_tool not null,
  provider text not null,
  model text not null,
  -- Inputs are stored as structured parameters (tone, language, platform),
  -- never the raw customer conversation, to keep personal data out of logs.
  input_summary jsonb not null default '{}'::jsonb,
  output jsonb,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  succeeded boolean not null default true,
  error_code text,
  created_at timestamptz not null default now()
);

create index ai_generations_workspace_idx on public.ai_generations (workspace_id);
create index ai_generations_workspace_month_idx
  on public.ai_generations (workspace_id, created_at desc);
create index ai_generations_tool_idx on public.ai_generations (workspace_id, tool);

alter table public.messages
  add constraint messages_ai_generation_fkey
  foreign key (ai_generation_id) references public.ai_generations (id) on delete set null;

create table public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  ai_generation_id uuid references public.ai_generations (id) on delete set null,
  platform text not null,
  objective text,
  language text not null default 'en',
  tone text,
  hook text,
  caption text not null,
  call_to_action text,
  hashtags text[] not null default '{}',
  whatsapp_message text,
  status public.content_draft_status not null default 'draft',
  -- Every stored draft records that a human accepted the AI output.
  is_ai_generated boolean not null default true,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_drafts_workspace_idx on public.content_drafts (workspace_id);
create index content_drafts_status_idx
  on public.content_drafts (workspace_id, status, created_at desc);

create trigger content_drafts_set_updated_at before update on public.content_drafts
  for each row execute function public.set_updated_at();
