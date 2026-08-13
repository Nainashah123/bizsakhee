-- BizSakhi: commerce - products, images, orders, line items, payments.
-- All monetary columns are integer minor units (paise for INR).

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  description text,
  sku text,
  price_minor bigint not null default 0 check (price_minor >= 0),
  sale_price_minor bigint check (sale_price_minor >= 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  stock_status public.stock_status not null default 'in_stock',
  stock_quantity integer check (stock_quantity >= 0),
  status public.product_status not null default 'draft',
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  check (sale_price_minor is null or sale_price_minor <= price_minor)
);

create index products_workspace_idx on public.products (workspace_id);
create index products_workspace_status_idx on public.products (workspace_id, status);
create index products_workspace_name_idx on public.products (workspace_id, lower(name));
create unique index products_workspace_sku_key
  on public.products (workspace_id, upper(sku)) where sku is not null;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  sku text,
  price_minor bigint check (price_minor >= 0),
  stock_quantity integer check (stock_quantity >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_workspace_idx on public.product_variants (workspace_id);
create index product_variants_product_idx on public.product_variants (product_id, position);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  -- Object path inside the `product-images` bucket. Binary never lives in SQL.
  storage_path text not null unique,
  alt_text text,
  width integer check (width > 0),
  height integer check (height > 0),
  byte_size integer check (byte_size > 0),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/avif'
  )),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_workspace_idx on public.product_images (workspace_id);
create index product_images_product_idx on public.product_images (product_id, position);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Human-facing sequential number, unique per workspace.
  order_number integer not null,
  contact_id uuid references public.contacts (id) on delete set null,
  status public.order_status not null default 'draft',
  payment_status public.payment_status not null default 'unpaid',
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  shipping_minor bigint not null default 0 check (shipping_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  tax_basis_points integer not null default 0
    check (tax_basis_points between 0 and 10000),
  notes text,
  due_on date,
  -- Unguessable share token for the public invoice page; only the hash is kept.
  invoice_token_hash text unique,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, order_number)
);

create index orders_workspace_idx on public.orders (workspace_id);
create index orders_status_idx on public.orders (workspace_id, status, created_at desc);
create index orders_payment_status_idx
  on public.orders (workspace_id, payment_status, created_at desc);
create index orders_contact_idx on public.orders (contact_id, created_at desc);

alter table public.tasks
  add constraint tasks_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete set null;
create index tasks_order_idx on public.tasks (order_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  -- Description is snapshotted so historic invoices survive product edits.
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_items_workspace_idx on public.order_items (workspace_id);
create index order_items_order_idx on public.order_items (order_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  method public.payment_method not null default 'upi',
  reference text,
  paid_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_workspace_idx on public.payments (workspace_id);
create index payments_order_idx on public.payments (order_id, paid_at desc);
create index payments_paid_at_idx on public.payments (workspace_id, paid_at desc);

-- ---------------------------------------------------------------------------
-- Per-workspace order numbering. A dedicated counter row is locked so two
-- concurrent inserts cannot claim the same number.
-- ---------------------------------------------------------------------------

create table public.order_counters (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  last_number integer not null default 0
);

create or replace function public.next_order_number(target_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_value integer;
begin
  insert into public.order_counters (workspace_id, last_number)
  values (target_workspace, 1)
  on conflict (workspace_id)
    do update set last_number = public.order_counters.last_number + 1
  returning last_number into next_value;

  return next_value;
end;
$$;

create or replace function public.assign_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null then
    new.order_number = public.next_order_number(new.workspace_id);
  end if;
  return new;
end;
$$;

-- The BEFORE INSERT trigger fills order_number, so the NOT NULL constraint
-- (checked after BEFORE triggers run) still holds.
create trigger orders_assign_number before insert on public.orders
  for each row execute function public.assign_order_number();

-- ---------------------------------------------------------------------------
-- Payment totals are derived, never trusted from the client.
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_order_payment(target_order uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  paid bigint;
  order_total bigint;
begin
  select coalesce(sum(p.amount_minor), 0) into paid
  from public.payments p
  where p.order_id = target_order;

  select o.total_minor into order_total
  from public.orders o
  where o.id = target_order;

  if order_total is null then
    return;
  end if;

  update public.orders o
  set amount_paid_minor = paid,
      payment_status = case
        when paid <= 0 then 'unpaid'::public.payment_status
        when paid < order_total then 'partially_paid'::public.payment_status
        else 'paid'::public.payment_status
      end
  where o.id = target_order;
end;
$$;

create or replace function public.payments_touch_order()
returns trigger
language plpgsql
as $$
begin
  perform public.recalculate_order_payment(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

create trigger payments_recalculate
  after insert or update or delete on public.payments
  for each row execute function public.payments_touch_order();

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger order_items_set_updated_at before update on public.order_items
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
