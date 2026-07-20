-- Ralph POS — record what the customer handed over ("tendered") on cash
-- payments, so change is computed, shown, and auditable.
--
-- Change itself is NOT stored: it is always tendered − total (or tendered −
-- (principal + fee) for services). Storing it would be a second copy that
-- could drift — same principle as never storing what a generated column can
-- compute.
--
-- tendered is only meaningful when physical cash changes hands:
--   sales:    payment_method = 'cash'
--   services: cash_flow = 'in' AND payment_account = 'cash'
-- Wallet transfers are exact by nature. The CHECKs encode all of this, so no
-- client can store an underpayment or a wallet-side tendered.

alter table public.transactions
  add column tendered numeric(12, 2)
  check (
    tendered is null
    or (payment_method = 'cash' and tendered >= total)
  );

comment on column public.transactions.tendered is
  'Cash handed over by the customer (cash sales only). NULL = not recorded/exact. Change = tendered − total, always derived.';

alter table public.service_transactions
  add column tendered numeric(12, 2)
  check (
    tendered is null
    or (cash_flow = 'in' and payment_account = 'cash'
        and tendered >= principal + fee)
  );

comment on column public.service_transactions.tendered is
  'Cash handed over (cash-in services paid via the box only). Change = tendered − (principal + fee), always derived.';

-- ---------------------------------------------------------------------------
-- checkout(): optional p_tendered
-- ---------------------------------------------------------------------------

drop function public.checkout(public.money_account, jsonb);

create function public.checkout(
  p_payment_method public.money_account,
  p_items jsonb,
  p_tendered numeric default null
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

  if p_tendered is not null then
    if p_payment_method <> 'cash' then
      raise exception 'Amount received only applies to cash payments';
    end if;
    if p_tendered < v_total then
      raise exception 'Amount received (%) is less than the total (%)', p_tendered, v_total;
    end if;
  end if;

  insert into public.transactions (payment_method, total, tendered)
  values (p_payment_method, v_total, p_tendered)
  returning id into v_transaction_id;

  insert into public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity)
  select v_transaction_id, p.id, p.name, p.price, c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  update public.products p
  set stock = p.stock - c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  where p.id = c.product_id;

  -- Payment method IS the destination account. Only the TOTAL enters the
  -- ledger: tendered − change nets to total, and change never sat in the box.
  insert into public.vault_entries (entry_type, amount, transaction_id, account)
  values ('sale', v_total, v_transaction_id, p_payment_method);

  return v_transaction_id;
end;
$$;

revoke all on function public.checkout(public.money_account, jsonb, numeric) from public, anon;
grant execute on function public.checkout(public.money_account, jsonb, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- record_service(): optional p_tendered
-- ---------------------------------------------------------------------------

drop function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text);

create function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric,
  p_payment_account public.money_account default 'cash',
  p_contact_number text default null,
  p_reference text default null,
  p_description text default null,
  p_tendered numeric default null
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

  if p_tendered is not null then
    if v_flow <> 'in' or p_payment_account <> 'cash' then
      raise exception 'Amount received only applies to cash-in services paid in cash';
    end if;
    if p_tendered < p_principal + p_fee then
      raise exception 'Amount received (%) is less than the amount due (%)', p_tendered, p_principal + p_fee;
    end if;
  end if;

  insert into public.service_transactions
    (service_id, service_name, cash_flow, principal, fee, wallet, payment_account,
     contact_number, reference, description, tendered)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account,
     nullif(trim(coalesce(p_contact_number, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_description, '')), ''),
     p_tendered)
  returning id into v_id;

  if v_flow = 'in' then
    v_pay_delta    := p_principal + p_fee;
    v_wallet_delta := -p_principal;
  else
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

revoke all on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric) to authenticated;
