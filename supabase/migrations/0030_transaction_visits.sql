-- Extends the "one visit, several sub-transactions" grouping (migration
-- 0029, e-services only) to product sales too -- a customer can buy from
-- the shelf and do a GCash cash-in in the same visit. Renamed to a plain
-- `visit_id` on both tables now, before it's used by any real data, so the
-- same concept has the same name everywhere instead of "service_visit_id"
-- only meaning something on one of the two tables.
alter table public.service_transactions
  rename column service_visit_id to visit_id;

alter table public.transactions
  add column visit_id uuid null;

create index idx_transactions_visit_id
  on public.transactions (visit_id)
  where visit_id is not null;

drop function public.checkout(jsonb, public.money_account, numeric, boolean);

create function public.checkout(
  p_items jsonb,
  p_payment_method public.money_account default null::public.money_account,
  p_tendered numeric default null::numeric,
  p_personal_take boolean default false,
  p_visit_id uuid default null::uuid
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_transaction_id uuid;
  v_total          numeric(12, 2);
  v_cart           jsonb;
  v_matched        integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  if p_personal_take then
    if p_payment_method is not null or p_tendered is not null then
      raise exception 'A personal take has no payment method and nothing tendered';
    end if;
  elsif p_payment_method is null then
    raise exception 'Payment method is required';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_id', pid, 'quantity', qty, 'discount_amount', disc
  ))
  into v_cart
  from (
    select
      (item ->> 'product_id')::uuid as pid,
      sum((item ->> 'quantity')::integer)::integer as qty,
      sum(coalesce((item ->> 'discount_amount')::numeric, 0)) as disc
    from jsonb_array_elements(p_items) as item
    group by 1
  ) collapsed;

  if exists (
    select 1
    from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer, discount_amount numeric)
    where c.product_id is null or c.quantity is null or c.quantity <= 0
      or c.discount_amount is null or c.discount_amount < 0
  ) then
    raise exception 'Each cart line needs a product_id, a quantity of at least 1, and a non-negative discount';
  end if;

  perform 1
  from public.products p
  where p.id in (
    select c.product_id
    from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer, discount_amount numeric)
  )
  order by p.id
  for update;

  select count(*)
  into v_matched
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer, discount_amount numeric)
  join public.products p on p.id = c.product_id;

  if v_matched <> jsonb_array_length(v_cart) then
    raise exception 'One or more products in the cart do not exist';
  end if;

  select sum(p.price * c.quantity - least(c.discount_amount, p.price * c.quantity))
  into v_total
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer, discount_amount numeric)
  join public.products p on p.id = c.product_id;

  if p_tendered is not null then
    if p_payment_method <> 'cash' then
      raise exception 'Amount received only applies to cash payments';
    end if;
    if p_tendered < v_total then
      raise exception 'Amount received (%) is less than the total (%)', p_tendered, v_total;
    end if;
  end if;

  insert into public.transactions (payment_method, total, tendered, is_personal_take, visit_id)
  values (p_payment_method, v_total, p_tendered, p_personal_take, p_visit_id)
  returning id into v_transaction_id;

  insert into public.transaction_items (
    transaction_id, product_id, product_name, unit_price, unit_cost, quantity, discount_amount
  )
  select
    v_transaction_id, p.id, p.name, p.price, p.cost, c.quantity,
    least(c.discount_amount, p.price * c.quantity)
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer, discount_amount numeric)
  join public.products p on p.id = c.product_id;

  update public.products p
  set stock = p.stock - c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer, discount_amount numeric)
  where p.id = c.product_id;

  if not p_personal_take and v_total > 0 then
    insert into public.vault_entries (entry_type, amount, transaction_id, account)
    values ('sale', v_total, v_transaction_id, p_payment_method);
  end if;

  return v_transaction_id;
end;
$function$;

revoke all on function public.checkout(jsonb, public.money_account, numeric, boolean, uuid) from public, anon;
grant execute on function public.checkout(jsonb, public.money_account, numeric, boolean, uuid) to authenticated;

-- record_service()'s parameter list is unchanged (p_visit_id already
-- existed as of migration 0029) -- only where it's written needs to follow
-- the column rename above.
create or replace function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric,
  p_payment_account public.money_account default 'cash'::public.money_account,
  p_contact_number text default null::text,
  p_reference text default null::text,
  p_description text default null::text,
  p_tendered numeric default null::numeric,
  p_fee_in_wallet boolean default false,
  p_unit_label text default null::text,
  p_unit_quantity integer default null::integer,
  p_unit_price numeric default null::numeric,
  p_visit_id uuid default null::uuid
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_name         text;
  v_flow         public.cash_flow;
  v_wallet       public.money_account;
  v_allowed      public.money_account[];
  v_id           uuid;
  v_pay_delta    numeric(12, 2);
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

  if (p_unit_label is not null or p_unit_quantity is not null or p_unit_price is not null)
     and (p_unit_label is null or p_unit_quantity is null or p_unit_price is null) then
    raise exception 'Unit pricing fields must be provided together';
  end if;
  if p_unit_quantity is not null and p_unit_quantity <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    raise exception 'Unit price must be 0 or more';
  end if;

  select s.name, s.cash_flow, s.wallet, s.allowed_payment_accounts
  into v_name, v_flow, v_wallet, v_allowed
  from public.services s
  where s.id = p_service_id and s.is_active;

  if not found then
    raise exception 'Service not found or inactive';
  end if;

  if not (p_payment_account = any(v_allowed)) then
    raise exception 'This service only accepts: %', array_to_string(v_allowed, ', ');
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
     contact_number, reference, description, tendered,
     unit_label, unit_quantity, unit_price, visit_id)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account,
     nullif(trim(coalesce(p_contact_number, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_description, '')), ''),
     p_tendered,
     p_unit_label, p_unit_quantity, p_unit_price, p_visit_id)
  returning id into v_id;

  if v_flow = 'in' then
    v_pay_delta    := p_principal + p_fee;
    v_wallet_delta := -p_principal;

    if v_pay_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_pay_delta, v_id, p_payment_account);
    end if;

    if v_wallet is not null and v_wallet_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_wallet_delta, v_id, v_wallet);
    end if;
  elsif v_wallet is not null and p_fee_in_wallet then
    v_pay_delta := -p_principal;
    if v_pay_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_pay_delta, v_id, p_payment_account);
    end if;

    v_wallet_delta := p_principal + p_fee;
    if v_wallet_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_wallet_delta, v_id, v_wallet);
    end if;
  else
    v_pay_delta := -p_principal;
    if v_pay_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_pay_delta, v_id, p_payment_account);
    end if;

    if p_fee <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account, note)
      values ('service', p_fee, v_id, p_payment_account, 'Fee received in cash');
    end if;

    v_wallet_delta := p_principal;
    if v_wallet is not null and v_wallet_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_wallet_delta, v_id, v_wallet);
    end if;
  end if;

  return v_id;
end;
$function$;
