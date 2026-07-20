-- Ralph POS — development-phase restructure (owner approved breaking changes)
--
-- 1. UNIFY payment methods with money accounts. A payment method IS the
--    account the money lands in — keeping two identical enums (payment_method
--    vs money_account) bought nothing but branch logic and a legacy
--    'e_wallet' value that Postgres can't drop in place. The two existing
--    e_wallet rows (dev data, ₱10) become 'gcash' — GCash was the store's
--    only wallet when they were recorded.
--    checkout() then writes a vault entry unconditionally: account = method.
--
-- 2. Services gain a PAYMENT SIDE choice: which of the three accounts the
--    customer-facing money moves through (default: the physical cash box).
--    An e-load paid via GCash transfer is now representable:
--      'in'  service, paid via gcash, wallet gcash:  gcash +(p+f), gcash −p  → net +fee
--      'in'  service, paid via cash,  wallet gcash:  cash  +(p+f), gcash −p
--      'out' service, paid from maya, wallet gcash:  maya  −p,     gcash +(p+f)

-- ---------------------------------------------------------------------------
-- 1. transactions.payment_method → public.money_account
-- ---------------------------------------------------------------------------

drop function public.checkout(public.payment_method, jsonb);

alter table public.transactions
  alter column payment_method type public.money_account
  using (
    case payment_method::text
      when 'e_wallet' then 'gcash'
      else payment_method::text
    end
  )::public.money_account;

drop type public.payment_method;

create function public.checkout(
  p_payment_method public.money_account,
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

  -- Payment method IS the destination account — no branching, every sale
  -- lands somewhere.
  insert into public.vault_entries (entry_type, amount, transaction_id, account)
  values ('sale', v_total, v_transaction_id, p_payment_method);

  return v_transaction_id;
end;
$$;

revoke all on function public.checkout(public.money_account, jsonb) from public, anon;
grant execute on function public.checkout(public.money_account, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Services: selectable payment side
-- ---------------------------------------------------------------------------

alter table public.service_transactions
  add column payment_account public.money_account not null default 'cash';
alter table public.service_transactions
  alter column payment_account drop default;

comment on column public.service_transactions.payment_account is
  'Which account the customer-facing money moved through (box or a wallet). The service''s own wallet leg is the `wallet` column.';

drop function public.record_service(uuid, numeric, numeric);

create function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric,
  p_payment_account public.money_account default 'cash'
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
  v_pay_delta  numeric(12, 2);
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

  insert into public.service_transactions
    (service_id, service_name, cash_flow, principal, fee, wallet, payment_account)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account)
  returning id into v_id;

  if v_flow = 'in' then
    -- Customer pays principal + fee into the chosen account;
    -- the load leaves the service's wallet.
    v_pay_delta    := p_principal + p_fee;
    v_wallet_delta := -p_principal;
  else
    -- You pay out the principal from the chosen account;
    -- principal + fee arrive in the service's wallet.
    v_pay_delta    := -p_principal;
    v_wallet_delta := p_principal + p_fee;
  end if;

  if v_pay_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
    values ('service', v_pay_delta, v_id, p_payment_account);
  end if;

  if v_wallet is not null and v_wallet_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
    values ('service', v_wallet_delta, v_id, v_wallet);
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_service(uuid, numeric, numeric, public.money_account) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric, public.money_account) to authenticated;
