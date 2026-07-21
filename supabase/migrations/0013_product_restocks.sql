-- Ralph POS — restock history, for cost-recovery / ROI tracking.
--
-- Owner's framing: "I bought ₱2000 worth of goods — has that been ROI'd
-- based on the history of inventory stocking?" This is NOT supplier-payable
-- tracking (no one is owed money here) — it's: how much did this batch cost,
-- and how much sales revenue has this product generated since?
--
-- Recovery is computed live, not stored: sum this product's transaction_items
-- (already historically accurate — unit_price snapshots the price at sale
-- time) from the restock's created_at onward, compare to the batch cost.
--
-- Approximation, by owner's explicit choice over strict FIFO: if a product
-- is restocked more than once, sales after the SECOND restock also count
-- toward the FIRST restock's "recovered" figure (there's no batch-level link
-- from a sale to which physical units it drew from). Older batches will look
-- better-recovered than they strictly deserve credit for. The app surfaces
-- this as a plain caveat rather than hiding it.

create table public.product_restocks (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid references public.products (id) on delete set null,
  product_name text not null,                                  -- snapshot
  quantity     integer not null check (quantity > 0),
  cost         numeric(12, 2) not null check (cost >= 0),       -- total spent on this batch
  note         text,
  cashier_id   uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at   timestamptz not null default now()
);

comment on table public.product_restocks is
  'One row per restock batch: quantity added and what it cost. Append-only history — corrections are new rows, not edits. "Recovered" is computed live from sales since created_at, not stored here.';

create index product_restocks_product_id_idx on public.product_restocks (product_id);
create index product_restocks_created_at_idx on public.product_restocks (created_at desc);

alter table public.product_restocks enable row level security;

create policy "staff read restocks" on public.product_restocks
  for select to authenticated using (true);

create policy "staff insert own restocks" on public.product_restocks
  for insert to authenticated with check (cashier_id = (select auth.uid()));

-- No update/delete policy: append-only, matching every other history table
-- in this app (transactions, service_transactions, vault_entries).

-- Supabase default privileges grant ALL on new tables to anon/authenticated
-- (see 0002) — trim to what the app uses.
revoke all on table public.product_restocks from anon;
revoke update, delete, truncate, references, trigger
  on table public.product_restocks from authenticated;

-- ---------------------------------------------------------------------------
-- record_restock(): atomically logs the batch and bumps stock. A single
-- `stock = stock + qty` UPDATE is safe under concurrent restocks without
-- extra locking — Postgres serializes concurrent increments on the same row.
--
-- NULL stock ("not tracked") is treated as 0 and starts counting from this
-- restock — matches the existing "restocking an untracked item begins
-- tracking it" behavior in the product form.
-- ---------------------------------------------------------------------------

create function public.record_restock(
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
  set stock = coalesce(stock, 0) + p_quantity
  where id = p_product_id;

  return v_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default; narrow it, and also revoke
-- from anon explicitly — CREATE FUNCTION's implicit PUBLIC grant is separate
-- from the default-privileges anon grant on tables (the 0002 lesson applies
-- to functions too).
revoke all on function public.record_restock(uuid, integer, numeric, text) from public, anon;
grant execute on function public.record_restock(uuid, integer, numeric, text) to authenticated;
