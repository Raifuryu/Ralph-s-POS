-- Per-line discount for the checkout cart. Entered in the UI as pesos or a
-- percent of that line's subtotal, but always converted down to and stored
-- as a single peso amount — simpler to total up and check than keeping
-- percent as a live formula. Clamped so a line can never go negative,
-- whether the clamp is bypassed client-side or the row is inserted directly
-- (authenticated has a plain INSERT grant on this table, same trust model as
-- unit_price/quantity's existing checks).
alter table public.transaction_items
  drop column line_total;

alter table public.transaction_items
  add column discount_amount numeric(12, 2) not null default 0;

alter table public.transaction_items
  add constraint transaction_items_discount_amount_check
  check (discount_amount >= 0);

alter table public.transaction_items
  add constraint transaction_items_discount_not_exceed_subtotal_check
  check (discount_amount <= unit_price * quantity);

alter table public.transaction_items
  add column line_total numeric(12, 2)
  generated always as (unit_price * quantity - discount_amount) stored;

comment on column public.transaction_items.discount_amount is
  'Peso amount knocked off this line''s subtotal (unit_price x quantity) at sale time. Entered as pesos or a percent in the UI, always stored as pesos. Never re-derived from anything live.';

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

  -- Discount clamped to the line's own subtotal here (never negative, never
  -- more than 100% off) — the same clamp the insert below applies, so the
  -- total charged always matches what actually gets recorded per line.
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
  -- was sold, so nothing enters the vault.
  if not p_personal_take then
    insert into public.vault_entries (entry_type, amount, transaction_id, account)
    values ('sale', v_total, v_transaction_id, p_payment_method);
  end if;

  return v_transaction_id;
end;
$function$;
