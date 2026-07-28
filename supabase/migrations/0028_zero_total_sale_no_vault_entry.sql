-- A fully-discounted line-item cart (100% off) clamps the transaction total
-- to 0. vault_entries requires a 'sale' row's amount to be > 0 (and a
-- 'void' row's to be <> 0) -- discounts now make that reachable through
-- normal use, not just a crafted/free product. Treat a 0 total the same way
-- personal takes already are: no cash moved, so nothing gets posted to the
-- vault, and nothing needs reversing on void either.
create or replace function public.checkout(
  p_items jsonb,
  p_payment_method public.money_account default null::public.money_account,
  p_tendered numeric default null::numeric,
  p_personal_take boolean default false
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

  insert into public.transactions (payment_method, total, tendered, is_personal_take)
  values (p_payment_method, v_total, p_tendered, p_personal_take)
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

  -- Personal takes deduct stock like any sale, but post no income: nothing
  -- was sold, so nothing enters the vault. A fully-discounted cart (total
  -- clamps to 0) is the same story from the vault's perspective -- no cash
  -- moved, so there's nothing to post; vault_entries also requires a 'sale'
  -- row to be > 0.
  if not p_personal_take and v_total > 0 then
    insert into public.vault_entries (entry_type, amount, transaction_id, account)
    values ('sale', v_total, v_transaction_id, p_payment_method);
  end if;

  return v_transaction_id;
end;
$function$;

create or replace function public.void_transaction(p_transaction_id uuid, p_reason text default null::text)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_transaction public.transactions;
begin
  select * into v_transaction
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Transaction not found';
  end if;
  if v_transaction.voided_at is not null then
    raise exception 'This transaction has already been voided';
  end if;

  update public.transactions
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_transaction_id;

  update public.products p
  set stock = p.stock + ti.quantity
  from public.transaction_items ti
  where ti.transaction_id = p_transaction_id
    and ti.product_id = p.id;

  -- A fully-discounted sale posts no vault_entries row at all (see
  -- checkout()), so voiding one must not try to reverse one either --
  -- otherwise 'void' would hit vault_entries' own amount <> 0 check.
  if not v_transaction.is_personal_take and v_transaction.total > 0 then
    insert into public.vault_entries (entry_type, amount, transaction_id, account, note)
    values (
      'void', -v_transaction.total, p_transaction_id, v_transaction.payment_method,
      'Void reversal'
    );
  end if;
end;
$function$;
