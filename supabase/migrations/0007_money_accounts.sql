-- Ralph POS — the vault becomes three money accounts: cash (the box), GCash,
-- and Maya. Completes the double-entry picture:
--
--   GCash load 100 + fee 5:   cash +105, gcash −100  → net +5  (= fee)
--   GCash cash-out 500/10:    cash −500, gcash +510  → net +10 (= fee)
--   Sale paid via GCash:      gcash +total
--   Pure-fee service (xerox): cash +fee
--
-- payment_method gains 'gcash' and 'maya'. 'e_wallet' cannot be dropped from
-- the enum and stays as a legacy label on old rows; new sales use the
-- specific wallet.

create type public.money_account as enum ('cash', 'gcash', 'maya');

alter type public.payment_method add value if not exists 'gcash';
alter type public.payment_method add value if not exists 'maya';

-- Every ledger entry belongs to an account. Table is empty pre-migration
-- (ledger shipped hours ago), so the default is only a formality — dropped
-- right after so future inserts must be explicit.
alter table public.vault_entries
  add column account public.money_account not null default 'cash';
alter table public.vault_entries
  alter column account drop default;

-- Which wallet a service touches. NULL = none (xerox, printing).
alter table public.services
  add column wallet public.money_account
  check (wallet is null or wallet <> 'cash');

alter table public.service_transactions
  add column wallet public.money_account
  check (wallet is null or wallet <> 'cash');

update public.services
set wallet = 'gcash'
where name in ('GCash Cash-in (Load)', 'GCash Cash-out');

drop index if exists vault_entries_count_seq_idx;
create index vault_entries_account_count_seq_idx
  on public.vault_entries (account, seq desc) where entry_type = 'count';
create index vault_entries_account_seq_idx
  on public.vault_entries (account, seq desc);

-- ---------------------------------------------------------------------------
-- Per-account balances (view shape changes → drop + recreate)
-- ---------------------------------------------------------------------------

drop view public.vault_balance;

create view public.vault_balance
with (security_invoker = true) as
select
  acct.account,
  (coalesce(lc.amount, 0) + coalesce(mv.total, 0))::numeric(12, 2) as balance,
  lc.created_at as last_counted_at
from unnest(enum_range(null::public.money_account)) as acct(account)
left join lateral (
  select amount, seq, created_at
  from public.vault_entries
  where entry_type = 'count' and account = acct.account
  order by seq desc
  limit 1
) lc on true
left join lateral (
  select sum(amount) as total
  from public.vault_entries v
  where v.entry_type <> 'count'
    and v.account = acct.account
    and v.seq > coalesce(lc.seq, 0)
) mv on true;

comment on view public.vault_balance is
  'One row per money account (cash box, GCash, Maya): balance = latest count for that account + movements after it.';

revoke all on table public.vault_balance from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.vault_balance from authenticated;

-- ---------------------------------------------------------------------------
-- checkout(): every sale now credits the account that was paid into.
-- Legacy 'e_wallet' (old clients only) keeps the old no-entry behavior —
-- there is no way to know which wallet it meant.
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

  if p_payment_method in ('cash', 'gcash', 'maya') then
    insert into public.vault_entries (entry_type, amount, transaction_id, account)
    values ('sale', v_total, v_transaction_id,
            (p_payment_method::text)::public.money_account);
  end if;

  return v_transaction_id;
end;
$$;

revoke all on function public.checkout(public.payment_method, jsonb) from public, anon;
grant execute on function public.checkout(public.payment_method, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- record_service(): now double-entry across box + wallet.
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
  v_name       text;
  v_flow       public.cash_flow;
  v_wallet     public.money_account;
  v_id         uuid;
  v_cash_delta numeric(12, 2);
  v_wallet_delta numeric(12, 2);
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

  select s.name, s.cash_flow, s.wallet into v_name, v_flow, v_wallet
  from public.services s
  where s.id = p_service_id and s.is_active;

  if not found then
    raise exception 'Service not found or inactive';
  end if;

  insert into public.service_transactions (service_id, service_name, cash_flow, principal, fee, wallet)
  values (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet)
  returning id into v_id;

  if v_flow = 'in' then
    -- Customer hands cash; the load leaves your wallet.
    v_cash_delta   := p_principal + p_fee;
    v_wallet_delta := -p_principal;
  else
    -- You hand out cash; principal + fee arrive in your wallet.
    v_cash_delta   := -p_principal;
    v_wallet_delta := p_principal + p_fee;
  end if;

  if v_cash_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
    values ('service', v_cash_delta, v_id, 'cash');
  end if;

  if v_wallet is not null and v_wallet_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
    values ('service', v_wallet_delta, v_id, v_wallet);
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_service(uuid, numeric, numeric) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- record_vault_count(): counts are per account now (signature change).
-- ---------------------------------------------------------------------------

drop function public.record_vault_count(numeric);

create function public.record_vault_count(
  p_account public.money_account,
  p_counted numeric
)
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

  select vb.balance into v_expected
  from public.vault_balance vb
  where vb.account = p_account;
  v_expected := coalesce(v_expected, 0);

  insert into public.vault_entries (entry_type, amount, expected, account)
  values ('count', v_counted, v_expected, p_account);

  return jsonb_build_object(
    'account', p_account,
    'counted', v_counted,
    'expected', v_expected,
    'over_short', v_counted - v_expected
  );
end;
$$;

revoke all on function public.record_vault_count(public.money_account, numeric) from public, anon;
grant execute on function public.record_vault_count(public.money_account, numeric) to authenticated;
