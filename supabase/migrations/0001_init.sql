-- Ralph POS — initial schema
--
-- Applied via the Supabase MCP server (apply_migration), which runs this in its
-- own transaction — hence no explicit begin/commit here.
--
-- Design note — historical price integrity:
--   `products.price` is the CURRENT price and is expected to change over time.
--   `transaction_items` snapshots the name and price AT THE MOMENT OF SALE, so
--   editing a product's price never rewrites past sales. `line_total` is computed
--   by Postgres itself and cannot drift from quantity * unit_price.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.payment_method as enum ('cash', 'e_wallet');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  price      numeric(10, 2) not null check (price >= 0),
  stock      integer not null default 0 check (stock >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.products.price is
  'Current selling price. Changing this does NOT affect past sales — transaction_items snapshots the price at sale time.';

create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  payment_method public.payment_method not null,
  cashier_id     uuid not null default auth.uid() references auth.users (id) on delete restrict,
  total          numeric(12, 2) not null check (total >= 0),
  created_at     timestamptz not null default now()
);

comment on table public.transactions is
  'Sale headers. Append-only: no UPDATE/DELETE grant or policy exists.';

create table public.transaction_items (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  -- Soft reference: history must survive the product being deleted.
  product_id     uuid references public.products (id) on delete set null,
  -- Snapshots, captured at sale time:
  product_name   text not null,
  unit_price     numeric(10, 2) not null check (unit_price >= 0),
  quantity       integer not null check (quantity > 0),
  -- Computed and persisted by Postgres; cannot be set or faked by a client.
  line_total     numeric(12, 2) not null generated always as (unit_price * quantity) stored
);

comment on column public.transaction_items.unit_price is
  'Price at the moment of sale. Never join to products.price for historical totals.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index products_active_name_idx      on public.products (name) where is_active;
create index transactions_created_at_idx   on public.transactions (created_at desc);
create index transactions_cashier_id_idx   on public.transactions (cashier_id);
create index transaction_items_txn_id_idx  on public.transaction_items (transaction_id);
create index transaction_items_product_idx on public.transaction_items (product_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Access model: single store, every signed-in staff member sees everything.
-- `using (true)` is deliberate here — the tenant IS the store. If this app ever
-- serves more than one store, these policies MUST be revisited.
-- ---------------------------------------------------------------------------

alter table public.products          enable row level security;
alter table public.transactions      enable row level security;
alter table public.transaction_items enable row level security;

-- Products: staff manage inventory freely.
create policy "staff read products" on public.products
  for select to authenticated using (true);

create policy "staff insert products" on public.products
  for insert to authenticated with check (true);

create policy "staff update products" on public.products
  for update to authenticated using (true) with check (true);

create policy "staff delete products" on public.products
  for delete to authenticated using (true);

-- Transactions: readable by all staff, insertable only as yourself.
-- No update/delete policy => sales history is append-only.
create policy "staff read transactions" on public.transactions
  for select to authenticated using (true);

create policy "staff insert own transactions" on public.transactions
  for insert to authenticated with check (cashier_id = (select auth.uid()));

-- Items: readable by all staff, insertable only against a transaction that exists.
create policy "staff read transaction items" on public.transaction_items
  for select to authenticated using (true);

create policy "staff insert transaction items" on public.transaction_items
  for insert to authenticated with check (
    exists (select 1 from public.transactions t where t.id = transaction_id)
  );

-- ---------------------------------------------------------------------------
-- Data API grants
--
-- Required: since 2026-04-28 new tables in `public` are NOT auto-exposed to the
-- Data API. Without these grants PostgREST cannot see the tables at all.
-- Note the deliberate absence of update/delete on the two history tables.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table public.products          to authenticated;
grant select, insert                 on table public.transactions      to authenticated;
grant select, insert                 on table public.transaction_items to authenticated;

-- ---------------------------------------------------------------------------
-- Checkout
--
-- SECURITY INVOKER: runs as the caller, so RLS still applies.
-- Prices are read from the products table server-side — the client sends only
-- {product_id, quantity} and can never dictate a price.
-- ---------------------------------------------------------------------------

create or replace function public.checkout(
  p_payment_method public.payment_method,
  p_items jsonb -- [{"product_id": "<uuid>", "quantity": 2}, ...]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_total          numeric(12, 2);
  v_cart           jsonb;
  v_matched        integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  -- Normalise once: collapse duplicate lines for the same product so the stock
  -- maths stays correct. No temp tables — `search_path = ''` cannot resolve
  -- unqualified pg_temp objects.
  select jsonb_agg(jsonb_build_object('product_id', pid, 'quantity', qty))
  into v_cart
  from (
    select
      (item ->> 'product_id')::uuid as pid,
      sum((item ->> 'quantity')::integer)::integer as qty
    from jsonb_array_elements(p_items) as item
    group by 1
  ) collapsed;

  if exists (
    select 1
    from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
    where c.product_id is null or c.quantity is null or c.quantity <= 0
  ) then
    raise exception 'Each cart line needs a product_id and a quantity of at least 1';
  end if;

  -- Lock the product rows before reading prices/stock: prevents two concurrent
  -- sales from both passing the stock check and overselling.
  perform 1
  from public.products p
  where p.id in (
    select c.product_id
    from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  )
  order by p.id
  for update;

  select count(*)
  into v_matched
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  if v_matched <> jsonb_array_length(v_cart) then
    raise exception 'One or more products in the cart do not exist';
  end if;

  -- Total from CURRENT server-side prices.
  select sum(p.price * c.quantity)
  into v_total
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  -- Insert the header with its final total, so `transactions` needs no UPDATE
  -- grant and stays append-only.
  insert into public.transactions (payment_method, total)
  values (p_payment_method, v_total)
  returning id into v_transaction_id;

  -- Snapshot name + price at this instant.
  insert into public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity)
  select v_transaction_id, p.id, p.name, p.price, c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  -- `check (stock >= 0)` aborts the whole transaction on oversell.
  update public.products p
  set stock = p.stock - c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  where p.id = c.product_id;

  return v_transaction_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default; narrow it to signed-in staff.
revoke all on function public.checkout(public.payment_method, jsonb) from public;
grant execute on function public.checkout(public.payment_method, jsonb) to authenticated;

