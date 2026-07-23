-- Ralph POS — Bulk restock's "new item" lines can now register a product
-- without stocking it yet (quantity/cost both blank — matches the plain
-- Add Item form's "leave Quantity blank" behavior), and carry a category +
-- description, so bulk restock can fully replace the single-item creation
-- form. Existing-item lines are unchanged: always a restock, quantity/cost
-- still required.
--
-- Same signature as before (still just p_items jsonb), so CREATE OR REPLACE
-- is enough — no DROP FUNCTION, and existing grants carry over untouched.

create or replace function public.record_bulk_restock(p_items jsonb)
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

  -- Exactly one of product_id/name per line; price always required.
  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, price numeric)
    where (c.product_id is null and coalesce(trim(c.name), '') = '')
       or (c.product_id is not null and coalesce(trim(c.name), '') <> '')
       or c.price is null or c.price <= 0
  ) then
    raise exception 'Each line needs an existing item or a new name (not both), and a price greater than 0';
  end if;

  -- Existing-item lines are always a restock: quantity + cost are required.
  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, quantity integer, cost numeric)
    where c.product_id is not null
      and (c.quantity is null or c.quantity <= 0 or c.cost is null or c.cost < 0)
  ) then
    raise exception 'Each restocked item needs a quantity of at least 1 and a cost of 0 or more';
  end if;

  -- New-item lines may register without stocking (quantity and cost both
  -- null — same "not tracked yet" idea as leaving Quantity blank on the
  -- single-item form) or restock alongside creation (both present and
  -- valid) — never a mix of only one.
  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, quantity integer, cost numeric)
    where c.product_id is null
      and (
        (c.quantity is null) <> (c.cost is null)
        or (c.quantity is not null and (c.quantity <= 0 or c.cost < 0))
      )
  ) then
    raise exception 'A new item needs both a quantity and a cost, or neither';
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

  -- Apply each line: existing → re-price then restock; new → create (stock
  -- starts NULL/untracked either way, matching Add Item's blank-quantity
  -- default) then restock only if quantity/cost were given.
  for v_item in
    select
      c.product_id,
      nullif(trim(c.name), '') as name,
      c.quantity,
      c.cost,
      c.price,
      c.category_id,
      nullif(trim(coalesce(c.description, '')), '') as description
    from jsonb_to_recordset(p_items)
      as c(product_id uuid, name text, quantity integer, cost numeric, price numeric, category_id uuid, description text)
  loop
    if v_item.product_id is not null then
      v_product_id := v_item.product_id;
      update public.products set price = v_item.price where id = v_product_id;
    else
      insert into public.products (name, price, stock, category_id, description)
      values (v_item.name, v_item.price, null, v_item.category_id, v_item.description)
      returning id into v_product_id;
    end if;

    if v_item.quantity is not null then
      select public.record_restock(v_product_id, v_item.quantity, v_item.cost)
      into v_restock_id;
    else
      v_restock_id := null;
    end if;

    v_result := v_result || jsonb_build_object(
      'product_id', v_product_id,
      'restock_id', v_restock_id
    );
  end loop;

  return jsonb_build_object('items', v_result);
end;
$$;
