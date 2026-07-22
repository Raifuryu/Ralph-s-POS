-- Ralph POS — personal takes: owner takes stock for personal use, not a
-- sale. Same cart-building flow as checkout, but no payment method and no
-- vault entry — inventory still leaves the shelf, but nothing is recorded
-- as income.

alter table public.transactions
  alter column payment_method drop not null;

alter table public.transactions
  add column is_personal_take boolean not null default false;

comment on column public.transactions.is_personal_take is
  'True when stock was taken for personal use rather than sold — payment_method and tendered are both NULL, and no vault_entries row is posted for it.';

alter table public.transactions
  add constraint transactions_personal_take_payment_check
  check (is_personal_take = (payment_method is null));

-- Belt-and-suspenders alongside the existing transactions_check (tendered
-- >= total for cash): that check passes vacuously when payment_method is
-- NULL (payment_method = 'cash' evaluates to NULL, not false), so it alone
-- would not stop a personal take from carrying a stray tendered value.
alter table public.transactions
  add constraint transactions_personal_take_tendered_check
  check (payment_method is not null or tendered is null);

-- A personal take isn't "selling well" — it's inventory the owner chose to
-- take out, not commercial demand. Keep it out of the top-sellers signal.
create or replace view public.product_sales_totals
with (security_invoker = true) as
select ti.product_id, sum(ti.quantity) as units_sold
from public.transaction_items ti
join public.transactions t on t.id = ti.transaction_id
where ti.product_id is not null and not t.is_personal_take
group by ti.product_id;

-- ---------------------------------------------------------------------------
-- checkout(): p_payment_method/p_tendered become optional (NULL), and a new
-- p_personal_take opts into the no-payment/no-income path. p_items has no
-- default and must stay first now that the others need one (Postgres
-- requires defaulted params to trail).
-- ---------------------------------------------------------------------------

drop function public.checkout(public.money_account, jsonb, numeric);

create function public.checkout(
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

  insert into public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity)
  select v_transaction_id, p.id, p.name, p.price, c.quantity
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

revoke all on function public.checkout(jsonb, public.money_account, numeric, boolean) from public, anon;
grant execute on function public.checkout(jsonb, public.money_account, numeric, boolean) to authenticated;
