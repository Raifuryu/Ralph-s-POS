-- Ralph POS — bulk restock: log a whole supplier receipt in one submit.
--
-- Each line is either an existing product (product_id) or a brand-new one
-- typed inline (name only, created here). Every line also sets that
-- product's selling price — restocking and re-pricing happen together,
-- unlike record_restock() which only touches stock/history.
--
-- Shape follows checkout(): validate the whole jsonb array up front (one
-- clear exception, no partial application), lock every existing product row
-- with `for update order by p.id` before writing (deadlock-safe under
-- concurrent bulk-restocks), then apply each line. New products need no
-- pre-lock — the insert is the only writer for a row that doesn't exist yet.
-- Line order in the array doesn't affect the result (each line touches a
-- distinct product, duplicates are rejected below), so no ordinality/index
-- tracking is needed.

create function public.record_bulk_restock(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item       record;
  v_product_id uuid;
  v_restock_id uuid;
  v_result     jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  -- Exactly one of product_id/name per line; quantity > 0; cost >= 0;
  -- price > 0 (price is always required — restocking always re-sets it).
  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric)
    where (c.product_id is null and coalesce(trim(c.name), '') = '')
       or (c.product_id is not null and coalesce(trim(c.name), '') <> '')
       or c.quantity is null or c.quantity <= 0
       or c.cost is null or c.cost < 0
       or c.price is null or c.price <= 0
  ) then
    raise exception 'Each line needs an existing item or a new name (not both), a quantity of at least 1, a cost of 0 or more, and a price greater than 0';
  end if;

  -- Reject the same existing product twice in one batch — with a per-line
  -- price this is ambiguous (which price wins?), so it's an outright error
  -- rather than silently collapsing like checkout() does for quantities.
  if exists (
    select c.product_id
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric)
    where c.product_id is not null
    group by c.product_id
    having count(*) > 1
  ) then
    raise exception 'Each item can only appear once in a single bulk restock';
  end if;

  -- Lock every existing product referenced, in a stable order, before any
  -- write — same deadlock-avoidance rationale as checkout().
  perform 1
  from public.products p
  where p.id in (
    select c.product_id
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric)
    where c.product_id is not null
  )
  order by p.id
  for update;

  -- Confirm every referenced existing product still exists (could have been
  -- deleted before this call took the locks above).
  if (
    select count(*)
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric)
    join public.products p on p.id = c.product_id
    where c.product_id is not null
  ) <> (
    select count(*)
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric)
    where c.product_id is not null
  ) then
    raise exception 'One or more selected items no longer exist';
  end if;

  -- Apply each line: existing → re-price then restock; new → create at
  -- stock 0 then restock brings it up to the batch quantity (mirrors
  -- createProduct's existing "insert then restock" flow).
  for v_item in
    select
      c.product_id,
      nullif(trim(c.name), '') as name,
      c.quantity,
      c.cost,
      c.price
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric)
  loop
    if v_item.product_id is not null then
      v_product_id := v_item.product_id;
      update public.products set price = v_item.price where id = v_product_id;
    else
      insert into public.products (name, price, stock)
      values (v_item.name, v_item.price, 0)
      returning id into v_product_id;
    end if;

    select public.record_restock(v_product_id, v_item.quantity, v_item.cost)
    into v_restock_id;

    v_result := v_result || jsonb_build_object(
      'product_id', v_product_id,
      'restock_id', v_restock_id
    );
  end loop;

  return jsonb_build_object('items', v_result);
end;
$$;

revoke all on function public.record_bulk_restock(jsonb) from public, anon;
grant execute on function public.record_bulk_restock(jsonb) to authenticated;
