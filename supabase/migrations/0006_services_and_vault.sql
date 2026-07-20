-- Ralph POS — service income (GCash load etc.) and the vault (cash box ledger)
--
-- Core accounting rule this schema encodes: FEE INCOME ≠ CASH MOVEMENT.
--   Cash-in service  (load 100, fee 15): box +115, income 15.
--   Cash-out service (500, fee 10):      box −500 (fee arrives in the e-wallet),
--                                        income still 10.
--   Pure-fee service (xerox: 0, fee 5):  box +5.
--   E-wallet product sales never touch the box.
--
-- Vault balance = latest physical count + all signed movements after it.
-- A count RE-BASELINES the ledger; pre-ledger history is deliberately not
-- backfilled — the first count absorbs it.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.cash_flow as enum ('in', 'out');

create type public.vault_entry_type as enum
  ('sale', 'service', 'deposit', 'withdrawal', 'count');

-- ---------------------------------------------------------------------------
-- Services catalogue
-- ---------------------------------------------------------------------------

create table public.services (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  -- Which way the BOX moves when this service is performed.
  cash_flow   public.cash_flow not null default 'in',
  -- Pre-fills the fee input at the counter; always editable there.
  default_fee numeric(10, 2) check (default_fee >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger services_touch_updated_at
  before update on public.services
  for each row execute function public.touch_updated_at();

insert into public.services (name, cash_flow, default_fee) values
  ('GCash Cash-in (Load)', 'in',  5.00),
  ('GCash Cash-out',       'out', 10.00),
  ('E-Load',               'in',  3.00);

-- ---------------------------------------------------------------------------
-- Service transactions (append-only, snapshot pattern like transaction_items)
-- ---------------------------------------------------------------------------

create table public.service_transactions (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid references public.services (id) on delete set null,
  service_name text not null,                  -- snapshot
  cash_flow    public.cash_flow not null,      -- snapshot
  principal    numeric(12, 2) not null check (principal >= 0),
  fee          numeric(10, 2) not null check (fee >= 0),  -- THE income
  cashier_id   uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  check (principal + fee > 0)
);

create index service_transactions_created_at_idx
  on public.service_transactions (created_at desc);
create index service_transactions_service_id_idx
  on public.service_transactions (service_id);

-- ---------------------------------------------------------------------------
-- Vault ledger
-- ---------------------------------------------------------------------------

create table public.vault_entries (
  id         uuid primary key default gen_random_uuid(),
  -- Monotonic ordering that never ties (timestamps can, within a transaction).
  seq        bigint generated always as identity,
  entry_type public.vault_entry_type not null,
  -- Signed movement: + into box, − out. For 'count': the counted total.
  amount     numeric(12, 2) not null,
  -- Balance the system expected at count time; counted − expected = over/short.
  expected   numeric(12, 2),
  transaction_id         uuid references public.transactions (id) on delete set null,
  service_transaction_id uuid references public.service_transactions (id) on delete set null,
  note       text,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (entry_type = 'count'      and amount >= 0 and expected is not null) or
    (entry_type = 'sale'       and amount > 0) or
    (entry_type = 'deposit'    and amount > 0) or
    (entry_type = 'withdrawal' and amount < 0) or
    (entry_type = 'service'    and amount <> 0)
  ),
  -- Money leaving the box always says why.
  check (entry_type <> 'withdrawal' or length(trim(coalesce(note, ''))) > 0)
);

create index vault_entries_seq_idx on public.vault_entries (seq desc);
create index vault_entries_count_seq_idx
  on public.vault_entries (seq desc) where entry_type = 'count';

-- ---------------------------------------------------------------------------
-- Balance view
-- ---------------------------------------------------------------------------

create view public.vault_balance
with (security_invoker = true) as
with last_count as (
  select amount, seq, created_at
  from public.vault_entries
  where entry_type = 'count'
  order by seq desc
  limit 1
)
select
  (coalesce((select amount from last_count), 0)
   + coalesce((
       select sum(v.amount)
       from public.vault_entries v
       where v.entry_type <> 'count'
         and v.seq > coalesce((select seq from last_count), 0)
     ), 0))::numeric(12, 2) as balance,
  (select created_at from last_count) as last_counted_at;

comment on view public.vault_balance is
  'Single row: current cash-box balance (latest count + movements after it) and when it was last physically counted.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.services             enable row level security;
alter table public.service_transactions enable row level security;
alter table public.vault_entries        enable row level security;

-- Services: staff-managed catalogue, like products.
create policy "staff read services" on public.services
  for select to authenticated using (true);
create policy "staff insert services" on public.services
  for insert to authenticated with check (true);
create policy "staff update services" on public.services
  for update to authenticated using (true) with check (true);
create policy "staff delete services" on public.services
  for delete to authenticated using (true);

-- Money history: readable by staff, insertable only as yourself, never
-- editable. Corrections are compensating entries.
create policy "staff read service transactions" on public.service_transactions
  for select to authenticated using (true);
create policy "staff insert own service transactions" on public.service_transactions
  for insert to authenticated with check (cashier_id = (select auth.uid()));

create policy "staff read vault entries" on public.vault_entries
  for select to authenticated using (true);
create policy "staff insert own vault entries" on public.vault_entries
  for insert to authenticated with check (created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants — trim Supabase's grant-ALL default privileges (the 0002 lesson)
-- ---------------------------------------------------------------------------

revoke all on table public.services             from anon;
revoke all on table public.service_transactions from anon;
revoke all on table public.vault_entries        from anon;
revoke all on table public.vault_balance        from anon;

revoke truncate, references, trigger
  on table public.services from authenticated;
revoke update, delete, truncate, references, trigger
  on table public.service_transactions from authenticated;
revoke update, delete, truncate, references, trigger
  on table public.vault_entries from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.vault_balance from authenticated;

-- ---------------------------------------------------------------------------
-- checkout() — unchanged except: cash sales now also write a vault entry.
-- ---------------------------------------------------------------------------

create or replace function public.checkout(
  p_payment_method public.payment_method,
  p_items jsonb
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

  select sum(p.price * c.quantity)
  into v_total
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  insert into public.transactions (payment_method, total)
  values (p_payment_method, v_total)
  returning id into v_transaction_id;

  insert into public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity)
  select v_transaction_id, p.id, p.name, p.price, c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  update public.products p
  set stock = p.stock - c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  where p.id = c.product_id;

  -- NEW: physical cash enters the box only on cash sales.
  if p_payment_method = 'cash' then
    insert into public.vault_entries (entry_type, amount, transaction_id)
    values ('sale', v_total, v_transaction_id);
  end if;

  return v_transaction_id;
end;
$$;

-- CREATE OR REPLACE preserves existing ACLs, but be explicit anyway.
revoke all on function public.checkout(public.payment_method, jsonb) from public, anon;
grant execute on function public.checkout(public.payment_method, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- record_service() — the client sends id + amounts; the DIRECTION comes from
-- the service row server-side (same principle as product prices in checkout).
-- ---------------------------------------------------------------------------

create or replace function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name  text;
  v_flow  public.cash_flow;
  v_id    uuid;
  v_delta numeric(12, 2);
begin
  if p_principal is null or p_principal < 0 then
    raise exception 'Amount must be 0 or more';
  end if;
  if p_fee is null or p_fee < 0 then
    raise exception 'Fee must be 0 or more';
  end if;
  if p_principal + p_fee <= 0 then
    raise exception 'Nothing to record';
  end if;

  select s.name, s.cash_flow into v_name, v_flow
  from public.services s
  where s.id = p_service_id and s.is_active;

  if not found then
    raise exception 'Service not found or inactive';
  end if;

  insert into public.service_transactions (service_id, service_name, cash_flow, principal, fee)
  values (p_service_id, v_name, v_flow, p_principal, p_fee)
  returning id into v_id;

  -- in:  box gains principal + fee.
  -- out: box loses the principal; the fee arrives in the e-wallet, not the box.
  v_delta := case when v_flow = 'in' then p_principal + p_fee else -p_principal end;

  if v_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id)
    values ('service', v_delta, v_id);
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_service(uuid, numeric, numeric) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- record_vault_count() — captures `expected` atomically server-side, so it
-- can't be faked by a client or go stale between page-load and submit.
-- ---------------------------------------------------------------------------

create or replace function public.record_vault_count(p_counted numeric)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected numeric(12, 2);
  v_counted  numeric(12, 2);
begin
  if p_counted is null or p_counted < 0 then
    raise exception 'Counted amount must be 0 or more';
  end if;
  v_counted := p_counted;

  select vb.balance into v_expected from public.vault_balance vb;
  v_expected := coalesce(v_expected, 0);

  insert into public.vault_entries (entry_type, amount, expected)
  values ('count', v_counted, v_expected);

  return jsonb_build_object(
    'counted', v_counted,
    'expected', v_expected,
    'over_short', v_counted - v_expected
  );
end;
$$;

revoke all on function public.record_vault_count(numeric) from public, anon;
grant execute on function public.record_vault_count(numeric) to authenticated;
