-- Ralph POS — per-item cost tracking, so store sales can show real profit
-- (price - cost) instead of gross revenue being the only number available.
-- Mirrors how e-service income already isolates fee (real profit) from
-- principal (pass-through) - store sales had no equivalent split until now:
-- checkout() posted the full sale total as "income," conflating revenue
-- with margin.
--
-- Cost model: "current cost per unit," the same simplicity price itself
-- already has - every restock's total batch cost / quantity becomes the
-- product's cost going forward, snapshotted onto each transaction_item at
-- sale time (same pattern unit_price already uses for the selling price).
-- Deliberately NOT FIFO/batch-tracked: 0013's restock-recovery feature
-- already established that batch-level attribution isn't tracked, and a
-- precise-looking number there would be inaccurate. A single rolling
-- "current cost" is honest about that same limitation while still being
-- useful for margin at time of sale.
--
-- Nullable throughout: existing products/sales predate this column and have
-- no cost data - NULL means "unknown," not zero, so profit calculations
-- must exclude these rather than silently treating them as 100% margin.

alter table public.products
  add column cost numeric(12, 2) null;

alter table public.products
  add constraint products_cost_nonnegative check (cost is null or cost >= 0);

alter table public.transaction_items
  add column unit_cost numeric(12, 2) null;

alter table public.transaction_items
  add constraint transaction_items_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0);

-- record_restock(): now also updates the product's current cost-per-unit
-- alongside stock. Same signature as before - CREATE OR REPLACE, existing
-- grants carry over untouched.
create or replace function public.record_restock(
  p_product_id uuid,
  p_quantity integer,
  p_cost numeric,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_id   uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'Cost must be 0 or more';
  end if;

  select p.name into v_name from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'Product not found';
  end if;

  insert into public.product_restocks (product_id, product_name, quantity, cost, note)
  values (
    p_product_id, v_name, p_quantity, p_cost,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  update public.products
  set stock = coalesce(stock, 0) + p_quantity,
      cost = round(p_cost / p_quantity, 2)
  where id = p_product_id;

  return v_id;
end;
$$;

-- checkout(): snapshot the product's current cost onto each line item, same
-- as unit_price already does for the selling price. Everything else is
-- unchanged from 0015 - same signature, so CREATE OR REPLACE is enough.
create or replace function public.checkout(
  p_items jsonb,
  p_payment_method public.money_account default null,
  p_tendered numeric default null,
  p_personal_take boolean default false
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

  if p_personal_take then
    if p_payment_method is not null or p_tendered is not null then
      raise exception 'A personal take has no payment method and nothing tendered';
    end if;
  elsif p_payment_method is null then
    raise exception 'Payment method is required';
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

  insert into public.transactions (payment_method, total, tendered, is_personal_take)
  values (p_payment_method, v_total, p_tendered, p_personal_take)
  returning id into v_transaction_id;

  insert into public.transaction_items (transaction_id, product_id, product_name, unit_price, unit_cost, quantity)
  select v_transaction_id, p.id, p.name, p.price, p.cost, c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  join public.products p on p.id = c.product_id;

  update public.products p
  set stock = p.stock - c.quantity
  from jsonb_to_recordset(v_cart) as c(product_id uuid, quantity integer)
  where p.id = c.product_id;

  -- Personal takes deduct stock like any sale, but post no income: nothing
  -- was sold, so nothing enters the vault.
  if not p_personal_take then
    insert into public.vault_entries (entry_type, amount, transaction_id, account)
    values ('sale', v_total, v_transaction_id, p_payment_method);
  end if;

  return v_transaction_id;
end;
$$;
