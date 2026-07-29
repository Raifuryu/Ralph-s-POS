-- Ralph POS — full schema snapshot, generated live from the production
-- database on 2026-07-28 via introspection (pg_get_functiondef,
-- pg_get_viewdef, pg_get_constraintdef, pg_get_indexdef, information_schema)
-- rather than assembled from the incremental supabase/migrations/ history.
--
-- This is a point-in-time REFERENCE snapshot, not a migration — it reflects
-- exactly what is live right now, including any drift from what the
-- individual migration files would produce if replayed in order. It is not
-- applied automatically and is not part of the migration chain; regenerate
-- it whenever you want an up-to-date single-file view of the schema.
--
-- Running this against an empty database reproduces the current schema
-- (assuming the `auth` schema already exists, as it does on every Supabase
-- project).

-- =============================================================================
-- Extensions
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- =============================================================================
-- Enum types
-- =============================================================================

create type public.cash_flow as enum ('in', 'out');
create type public.money_account as enum ('cash', 'gcash', 'maya');
create type public.service_pricing_mode as enum ('flat', 'per_unit');
create type public.vault_entry_type as enum ('sale', 'service', 'deposit', 'withdrawal', 'count', 'void');

-- =============================================================================
-- Tables
-- =============================================================================

create table public.categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table public.products (
  id uuid not null default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null,
  stock integer,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  description text,
  category_id uuid,
  low_stock_threshold integer,
  cost numeric(12,2),
  expiry_date date
);

create table public.product_restocks (
  id uuid not null default gen_random_uuid(),
  product_id uuid,
  product_name text not null,
  quantity integer not null,
  cost numeric(12,2) not null,
  note text,
  cashier_id uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now()
);

create table public.services (
  id uuid not null default gen_random_uuid(),
  name text not null,
  cash_flow cash_flow not null default 'in'::cash_flow,
  default_fee numeric(10,2),
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  wallet money_account,
  allowed_payment_accounts money_account[] not null default '{cash}'::money_account[],
  fee_tiers jsonb not null default '[]'::jsonb,
  pricing_mode service_pricing_mode not null default 'flat'::service_pricing_mode,
  unit_prices jsonb
);

create table public.transactions (
  id uuid not null default gen_random_uuid(),
  payment_method money_account,
  cashier_id uuid not null default auth.uid(),
  total numeric(12,2) not null,
  created_at timestamp with time zone not null default now(),
  tendered numeric(12,2),
  is_personal_take boolean not null default false,
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  visit_id uuid
);

create table public.transaction_items (
  id uuid not null default gen_random_uuid(),
  transaction_id uuid not null,
  product_id uuid,
  product_name text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null,
  unit_cost numeric(12,2),
  discount_amount numeric(12,2) not null default 0,
  line_total numeric(12,2) generated always as (((unit_price * (quantity)::numeric) - discount_amount)) stored
);

create table public.service_transactions (
  id uuid not null default gen_random_uuid(),
  service_id uuid,
  service_name text not null,
  cash_flow cash_flow not null,
  principal numeric(12,2) not null,
  fee numeric(10,2) not null,
  cashier_id uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  wallet money_account,
  payment_account money_account not null,
  contact_number text,
  reference text,
  description text,
  tendered numeric(12,2),
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  unit_label text,
  unit_quantity integer,
  unit_price numeric(12,2),
  visit_id uuid,
  discount_amount numeric(12,2) not null default 0
);

create table public.vault_entries (
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  entry_type vault_entry_type not null,
  amount numeric(12,2) not null,
  expected numeric(12,2),
  transaction_id uuid,
  service_transaction_id uuid,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  account money_account not null
);

-- =============================================================================
-- Constraints
-- =============================================================================

-- categories
alter table public.categories add constraint categories_pkey PRIMARY KEY (id);
alter table public.categories add constraint categories_name_key UNIQUE (name);
alter table public.categories add constraint categories_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));

-- products
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.products add constraint products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.products add constraint products_cost_nonnegative CHECK (((cost IS NULL) OR (cost >= (0)::numeric)));
alter table public.products add constraint products_low_stock_threshold_nonnegative CHECK (((low_stock_threshold IS NULL) OR (low_stock_threshold >= 0)));
alter table public.products add constraint products_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public.products add constraint products_price_check CHECK ((price >= (0)::numeric));

-- product_restocks
alter table public.product_restocks add constraint product_restocks_pkey PRIMARY KEY (id);
alter table public.product_restocks add constraint product_restocks_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.product_restocks add constraint product_restocks_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.product_restocks add constraint product_restocks_cost_check CHECK ((cost >= (0)::numeric));
alter table public.product_restocks add constraint product_restocks_quantity_check CHECK ((quantity > 0));

-- services
alter table public.services add constraint services_pkey PRIMARY KEY (id);
alter table public.services add constraint services_name_key UNIQUE (name);
alter table public.services add constraint services_allowed_payment_accounts_check CHECK ((cardinality(allowed_payment_accounts) > 0));
alter table public.services add constraint services_default_fee_check CHECK ((default_fee >= (0)::numeric));
alter table public.services add constraint services_fee_tiers_is_array CHECK ((jsonb_typeof(fee_tiers) = 'array'::text));
alter table public.services add constraint services_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public.services add constraint services_per_unit_no_wallet_check CHECK (((pricing_mode = 'flat'::service_pricing_mode) OR (wallet IS NULL)));
alter table public.services add constraint services_pricing_mode_check CHECK ((((pricing_mode = 'flat'::service_pricing_mode) AND (unit_prices IS NULL)) OR ((pricing_mode = 'per_unit'::service_pricing_mode) AND (unit_prices IS NOT NULL) AND (jsonb_typeof(unit_prices) = 'array'::text) AND (jsonb_array_length(unit_prices) > 0))));
alter table public.services add constraint services_wallet_check CHECK (((wallet IS NULL) OR (wallet <> 'cash'::money_account)));

-- transactions
alter table public.transactions add constraint transactions_pkey PRIMARY KEY (id);
alter table public.transactions add constraint transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.transactions add constraint transactions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.transactions add constraint transactions_check CHECK (((tendered IS NULL) OR ((payment_method = 'cash'::money_account) AND (tendered >= total))));
alter table public.transactions add constraint transactions_personal_take_payment_check CHECK ((is_personal_take = (payment_method IS NULL)));
alter table public.transactions add constraint transactions_personal_take_tendered_check CHECK (((payment_method IS NOT NULL) OR (tendered IS NULL)));
alter table public.transactions add constraint transactions_total_check CHECK ((total >= (0)::numeric));
alter table public.transactions add constraint transactions_void_fields_check CHECK (((voided_at IS NOT NULL) OR ((voided_by IS NULL) AND (void_reason IS NULL))));

-- transaction_items
alter table public.transaction_items add constraint transaction_items_pkey PRIMARY KEY (id);
alter table public.transaction_items add constraint transaction_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.transaction_items add constraint transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
alter table public.transaction_items add constraint transaction_items_discount_amount_check CHECK ((discount_amount >= (0)::numeric));
alter table public.transaction_items add constraint transaction_items_discount_not_exceed_subtotal_check CHECK ((discount_amount <= (unit_price * (quantity)::numeric)));
alter table public.transaction_items add constraint transaction_items_quantity_check CHECK ((quantity > 0));
alter table public.transaction_items add constraint transaction_items_unit_cost_nonnegative CHECK (((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)));
alter table public.transaction_items add constraint transaction_items_unit_price_check CHECK ((unit_price >= (0)::numeric));

-- service_transactions
alter table public.service_transactions add constraint service_transactions_pkey PRIMARY KEY (id);
alter table public.service_transactions add constraint service_transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.service_transactions add constraint service_transactions_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
alter table public.service_transactions add constraint service_transactions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.service_transactions add constraint service_transactions_check CHECK (((principal + fee) > (0)::numeric));
alter table public.service_transactions add constraint service_transactions_check1 CHECK (((tendered IS NULL) OR ((cash_flow = 'in'::cash_flow) AND (payment_account = 'cash'::money_account) AND (tendered >= (principal + fee)))));
alter table public.service_transactions add constraint service_transactions_discount_amount_check CHECK ((discount_amount >= (0)::numeric));
alter table public.service_transactions add constraint service_transactions_fee_check CHECK ((fee >= (0)::numeric));
alter table public.service_transactions add constraint service_transactions_principal_check CHECK ((principal >= (0)::numeric));
alter table public.service_transactions add constraint service_transactions_unit_fields_check CHECK ((((unit_label IS NULL) AND (unit_quantity IS NULL) AND (unit_price IS NULL)) OR ((unit_label IS NOT NULL) AND (length(TRIM(BOTH FROM unit_label)) > 0) AND (unit_quantity IS NOT NULL) AND (unit_quantity > 0) AND (unit_price IS NOT NULL) AND (unit_price >= (0)::numeric))));
alter table public.service_transactions add constraint service_transactions_void_fields_check CHECK (((voided_at IS NOT NULL) OR ((voided_by IS NULL) AND (void_reason IS NULL))));
alter table public.service_transactions add constraint service_transactions_wallet_check CHECK (((wallet IS NULL) OR (wallet <> 'cash'::money_account)));

-- vault_entries
alter table public.vault_entries add constraint vault_entries_pkey PRIMARY KEY (id);
alter table public.vault_entries add constraint vault_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.vault_entries add constraint vault_entries_service_transaction_id_fkey FOREIGN KEY (service_transaction_id) REFERENCES service_transactions(id) ON DELETE SET NULL;
alter table public.vault_entries add constraint vault_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
alter table public.vault_entries add constraint vault_entries_check CHECK ((((entry_type = 'count'::vault_entry_type) AND (amount >= (0)::numeric) AND (expected IS NOT NULL)) OR ((entry_type = 'sale'::vault_entry_type) AND (amount > (0)::numeric)) OR ((entry_type = 'deposit'::vault_entry_type) AND (amount > (0)::numeric)) OR ((entry_type = 'withdrawal'::vault_entry_type) AND (amount < (0)::numeric)) OR ((entry_type = 'service'::vault_entry_type) AND (amount <> (0)::numeric)) OR ((entry_type = 'void'::vault_entry_type) AND (amount <> (0)::numeric))));
alter table public.vault_entries add constraint vault_entries_check1 CHECK (((entry_type <> 'withdrawal'::vault_entry_type) OR (length(TRIM(BOTH FROM COALESCE(note, ''::text))) > 0)));

-- =============================================================================
-- Indexes (beyond those backing the constraints above)
-- =============================================================================

CREATE INDEX product_restocks_created_at_idx ON public.product_restocks USING btree (created_at DESC);
CREATE INDEX product_restocks_product_id_idx ON public.product_restocks USING btree (product_id);
CREATE INDEX products_active_name_idx ON public.products USING btree (name) WHERE is_active;
CREATE INDEX products_category_id_idx ON public.products USING btree (category_id);
CREATE INDEX idx_service_transactions_visit_id ON public.service_transactions USING btree (visit_id) WHERE (visit_id IS NOT NULL);
CREATE INDEX service_transactions_created_at_idx ON public.service_transactions USING btree (created_at DESC);
CREATE INDEX service_transactions_service_id_idx ON public.service_transactions USING btree (service_id);
CREATE INDEX transaction_items_product_idx ON public.transaction_items USING btree (product_id);
CREATE INDEX transaction_items_txn_id_idx ON public.transaction_items USING btree (transaction_id);
CREATE INDEX idx_transactions_visit_id ON public.transactions USING btree (visit_id) WHERE (visit_id IS NOT NULL);
CREATE INDEX transactions_cashier_id_idx ON public.transactions USING btree (cashier_id);
CREATE INDEX transactions_created_at_idx ON public.transactions USING btree (created_at DESC);
CREATE INDEX vault_entries_account_count_seq_idx ON public.vault_entries USING btree (account, seq DESC) WHERE (entry_type = 'count'::vault_entry_type);
CREATE INDEX vault_entries_account_seq_idx ON public.vault_entries USING btree (account, seq DESC);
CREATE INDEX vault_entries_seq_idx ON public.vault_entries USING btree (seq DESC);

-- =============================================================================
-- Functions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_restock(p_product_id uuid, p_quantity integer, p_cost numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_bulk_restock(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.checkout(p_items jsonb, p_payment_method money_account DEFAULT NULL::money_account, p_tendered numeric DEFAULT NULL::numeric, p_personal_take boolean DEFAULT false, p_visit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_service(p_service_id uuid, p_principal numeric, p_fee numeric, p_payment_account money_account DEFAULT 'cash'::money_account, p_contact_number text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_tendered numeric DEFAULT NULL::numeric, p_fee_in_wallet boolean DEFAULT false, p_unit_label text DEFAULT NULL::text, p_unit_quantity integer DEFAULT NULL::integer, p_unit_price numeric DEFAULT NULL::numeric, p_visit_id uuid DEFAULT NULL::uuid, p_discount_amount numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if p_discount_amount is null or p_discount_amount < 0 then
    raise exception 'Discount must be 0 or more';
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

  if p_unit_label is not null then
    -- Per-unit: fee is always derived here from unit_price x quantity minus
    -- the discount, never trusted as a separately-submitted number -- so a
    -- discount and the actual charged fee can never drift apart (the same
    -- reasoning transaction_items.line_total is a generated column, not a
    -- client-submitted one).
    p_fee := p_unit_price * p_unit_quantity - p_discount_amount;
    if p_fee < 0 then
      raise exception 'Discount cannot exceed the line''s own subtotal';
    end if;
  elsif p_discount_amount > 0 then
    raise exception 'Discount only applies to a per-unit service line';
  end if;

  if p_fee is null or p_fee < 0 then
    raise exception 'Fee must be 0 or more';
  end if;
  if p_principal + p_fee <= 0 then
    raise exception 'Nothing to record';
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
     unit_label, unit_quantity, unit_price, visit_id, discount_amount)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account,
     nullif(trim(coalesce(p_contact_number, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_description, '')), ''),
     p_tendered,
     p_unit_label, p_unit_quantity, p_unit_price, p_visit_id, p_discount_amount)
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_visit(p_items jsonb DEFAULT NULL::jsonb, p_payment_method money_account DEFAULT NULL::money_account, p_tendered numeric DEFAULT NULL::numeric, p_personal_take boolean DEFAULT false, p_services jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_visit_id uuid := gen_random_uuid();
  v_line     jsonb;
begin
  if (p_items is null or jsonb_array_length(p_items) = 0)
     and (p_services is null or jsonb_array_length(p_services) = 0) then
    raise exception 'Nothing to record';
  end if;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    perform public.checkout(p_items, p_payment_method, p_tendered, p_personal_take, v_visit_id);
  end if;

  if p_services is not null then
    for v_line in select * from jsonb_array_elements(p_services)
    loop
      perform public.record_service(
        p_service_id := (v_line ->> 'service_id')::uuid,
        p_principal := (v_line ->> 'principal')::numeric,
        p_fee := (v_line ->> 'fee')::numeric,
        p_payment_account := coalesce((v_line ->> 'payment_account')::public.money_account, 'cash'::public.money_account),
        p_contact_number := v_line ->> 'contact_number',
        p_reference := v_line ->> 'reference',
        p_description := v_line ->> 'description',
        p_tendered := nullif(v_line ->> 'tendered', '')::numeric,
        p_fee_in_wallet := coalesce((v_line ->> 'fee_in_wallet')::boolean, false),
        p_unit_label := nullif(v_line ->> 'unit_label', ''),
        p_unit_quantity := nullif(v_line ->> 'unit_quantity', '')::integer,
        p_unit_price := nullif(v_line ->> 'unit_price', '')::numeric,
        p_visit_id := v_visit_id,
        p_discount_amount := coalesce((v_line ->> 'discount_amount')::numeric, 0)
      );
    end loop;
  end if;

  return v_visit_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.void_service_transaction(p_service_transaction_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_voided_at timestamptz;
begin
  select voided_at into v_voided_at
  from public.service_transactions
  where id = p_service_transaction_id
  for update;

  if not found then
    raise exception 'Service transaction not found';
  end if;
  if v_voided_at is not null then
    raise exception 'This service transaction has already been voided';
  end if;

  update public.service_transactions
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_service_transaction_id;

  insert into public.vault_entries (entry_type, amount, service_transaction_id, account, note)
  select 'void', -ve.amount, p_service_transaction_id, ve.account, 'Void reversal'
  from public.vault_entries ve
  where ve.service_transaction_id = p_service_transaction_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_vault_count(p_account money_account, p_counted numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_expected numeric(12, 2);
  v_counted  numeric(12, 2);
begin
  if p_counted is null or p_counted < 0 then
    raise exception 'Counted amount must be 0 or more';
  end if;
  v_counted := p_counted;

  select vb.balance into v_expected
  from public.vault_balance vb
  where vb.account = p_account;
  v_expected := coalesce(v_expected, 0);

  insert into public.vault_entries (entry_type, amount, expected, account)
  values ('count', v_counted, v_expected, p_account);

  return jsonb_build_object(
    'account', p_account,
    'counted', v_counted,
    'expected', v_expected,
    'over_short', v_counted - v_expected
  );
end;
$function$
;

-- =============================================================================
-- Triggers
-- =============================================================================

CREATE TRIGGER products_touch_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER services_touch_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Auto-enables RLS the moment any new table is created in public — belt and
-- suspenders alongside remembering to add `enable row level security`
-- explicitly in each migration.
create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.categories enable row level security;
alter table public.product_restocks enable row level security;
alter table public.products enable row level security;
alter table public.service_transactions enable row level security;
alter table public.services enable row level security;
alter table public.transaction_items enable row level security;
alter table public.transactions enable row level security;
alter table public.vault_entries enable row level security;

create policy "staff read categories" on public.categories as PERMISSIVE for SELECT to authenticated
  using (true);

create policy "staff insert own restocks" on public.product_restocks as PERMISSIVE for INSERT to authenticated
  with check ((cashier_id = ( SELECT auth.uid() AS uid)));
create policy "staff read restocks" on public.product_restocks as PERMISSIVE for SELECT to authenticated
  using (true);

create policy "staff delete products" on public.products as PERMISSIVE for DELETE to authenticated
  using (true);
create policy "staff insert products" on public.products as PERMISSIVE for INSERT to authenticated
  with check (true);
create policy "staff read products" on public.products as PERMISSIVE for SELECT to authenticated
  using (true);
create policy "staff update products" on public.products as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);

create policy "staff insert own service transactions" on public.service_transactions as PERMISSIVE for INSERT to authenticated
  with check ((cashier_id = ( SELECT auth.uid() AS uid)));
create policy "staff read service transactions" on public.service_transactions as PERMISSIVE for SELECT to authenticated
  using (true);
create policy "staff void service transactions" on public.service_transactions as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);

create policy "staff delete services" on public.services as PERMISSIVE for DELETE to authenticated
  using (true);
create policy "staff insert services" on public.services as PERMISSIVE for INSERT to authenticated
  with check (true);
create policy "staff read services" on public.services as PERMISSIVE for SELECT to authenticated
  using (true);
create policy "staff update services" on public.services as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);

create policy "staff insert transaction items" on public.transaction_items as PERMISSIVE for INSERT to authenticated
  with check ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE (t.id = transaction_items.transaction_id))));
create policy "staff read transaction items" on public.transaction_items as PERMISSIVE for SELECT to authenticated
  using (true);

create policy "staff insert own transactions" on public.transactions as PERMISSIVE for INSERT to authenticated
  with check ((cashier_id = ( SELECT auth.uid() AS uid)));
create policy "staff read transactions" on public.transactions as PERMISSIVE for SELECT to authenticated
  using (true);
create policy "staff void transactions" on public.transactions as PERMISSIVE for UPDATE to authenticated
  using (true)
  with check (true);

create policy "staff insert own vault entries" on public.vault_entries as PERMISSIVE for INSERT to authenticated
  with check ((created_by = ( SELECT auth.uid() AS uid)));
create policy "staff read vault entries" on public.vault_entries as PERMISSIVE for SELECT to authenticated
  using (true);

-- =============================================================================
-- Views
-- =============================================================================

create view public.product_sales_totals
with (security_invoker = true)
as
select ti.product_id,
    sum(ti.quantity) as units_sold
   from transaction_items ti
     join transactions t on t.id = ti.transaction_id
  where ti.product_id is not null and not t.is_personal_take and t.voided_at is null and t.created_at >= (now() - '3 days'::interval)
  group by ti.product_id;

create view public.vault_balance
with (security_invoker = true)
as
select acct.account,
    (coalesce(lc.amount, 0::numeric) + coalesce(mv.total, 0::numeric))::numeric(12,2) as balance,
    lc.created_at as last_counted_at
   from unnest(enum_range(null::money_account)) acct(account)
     left join lateral ( select vault_entries.amount,
            vault_entries.seq,
            vault_entries.created_at
           from vault_entries
          where vault_entries.entry_type = 'count'::vault_entry_type and vault_entries.account = acct.account
          order by vault_entries.seq desc
         limit 1) lc on true
     left join lateral ( select sum(v.amount) as total
           from vault_entries v
          where v.entry_type <> 'count'::vault_entry_type and v.account = acct.account and v.seq > coalesce(lc.seq, 0::bigint)) mv on true;

-- =============================================================================
-- Grants
--
-- Supabase's default privileges grant ALL on new relations to anon and
-- authenticated; every migration in this project explicitly revokes from
-- anon and narrows authenticated down to what the app actually uses. The
-- grants below reflect exactly what's live — including one known gap:
-- product_sales_totals never had its inherited ALL-privileges grant to
-- authenticated revoked (only anon was), so it still carries far more than
-- the SELECT it actually needs. Left as-is here since this file mirrors
-- reality rather than silently patching it.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

grant select on table public.categories to authenticated;

grant insert, select on table public.product_restocks to authenticated;

grant delete, insert, select, update on table public.products to authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.product_sales_totals to authenticated;

grant insert, select on table public.service_transactions to authenticated;

grant delete, insert, select, update on table public.services to authenticated;

grant insert, select on table public.transaction_items to authenticated;

grant insert, select on table public.transactions to authenticated;

grant select on table public.vault_balance to authenticated;

grant insert, select on table public.vault_entries to authenticated;

grant execute on function public.checkout(jsonb, money_account, numeric, boolean, uuid) to authenticated;
grant execute on function public.record_bulk_restock(jsonb) to authenticated;
grant execute on function public.record_restock(uuid, integer, numeric, text) to authenticated;
grant execute on function public.record_service(uuid, numeric, numeric, money_account, text, text, text, numeric, boolean, text, integer, numeric, uuid, numeric) to authenticated;
grant execute on function public.record_vault_count(money_account, numeric) to authenticated;
grant execute on function public.record_visit(jsonb, money_account, numeric, boolean, jsonb) to authenticated;
grant execute on function public.void_service_transaction(uuid, text) to authenticated;
grant execute on function public.void_transaction(uuid, text) to authenticated;

-- Trigger/event-trigger support functions — never explicitly revoked from
-- anon, so Postgres's default PUBLIC EXECUTE grant still applies to both
-- roles. Harmless (touch_updated_at only fires from a BEFORE UPDATE
-- trigger; rls_auto_enable only fires as an event trigger, and its DDL
-- itself is gated by ordinary schema privileges), but flagged here rather
-- than silently omitted.
grant execute on function public.touch_updated_at() to anon, authenticated;
grant execute on function public.rls_auto_enable() to anon, authenticated;

-- =============================================================================
-- Comments
-- =============================================================================

comment on table public.categories is 'Product categories, seeded with typical sari-sari store sections. Managed as data, not schema.';
comment on table public.product_restocks is 'One row per restock batch: quantity added and what it cost. Append-only history — corrections are new rows, not edits. "Recovered" is computed live from sales since created_at, not stored here.';
comment on table public.transactions is 'Sale headers. Append-only: no UPDATE/DELETE grant or policy exists.';
comment on table public.product_sales_totals is 'Units sold per product in the trailing 3 days (rolling window, re-evaluated on every query) — powers the checkout quick-pick chips. Excludes personal takes and voided sales. Products with no recent sales simply do not appear.';
comment on table public.vault_balance is 'One row per money account (cash box, GCash, Maya): balance = latest count for that account + movements after it.';

comment on column public.products.description is 'Optional free-form note about the item.';
comment on column public.products.low_stock_threshold is 'Per-product override for the inventory list''s "low stock" indicator threshold. NULL means use the store-wide default.';
comment on column public.products.price is 'Current selling price. Changing this does NOT affect past sales — transaction_items snapshots the price at sale time.';
comment on column public.products.stock is 'On-hand quantity. NULL = not quantity-tracked. Negative = oversold past the recorded count — recount and correct in Inventory.';

comment on column public.transactions.is_personal_take is 'True when stock was taken for personal use rather than sold — payment_method and tendered are both NULL, and no vault_entries row is posted for it.';
comment on column public.transactions.tendered is 'Cash handed over by the customer (cash sales only). NULL = not recorded/exact. Change = tendered − total, always derived.';
comment on column public.transactions.voided_at is 'Set when a cashier voids a mistaken sale/take. Stock and any posted vault income are reversed via void_transaction() — this column and the reversing vault_entries row are the only trace; the original rows are never edited or deleted.';

comment on column public.transaction_items.discount_amount is 'Peso amount knocked off this line''s subtotal (unit_price x quantity) at sale time. Entered as pesos or a percent in the UI, always stored as pesos. Never re-derived from anything live.';
comment on column public.transaction_items.unit_price is 'Price at the moment of sale. Never join to products.price for historical totals.';

comment on column public.services.allowed_payment_accounts is 'Which vault accounts a customer may pay through (cash_flow=in) or be paid from (cash_flow=out) for this service. Enforced server-side by record_service(). Defaults to cash-only; widen per service as needed.';
comment on column public.services.fee_tiers is 'Ordered list of {min, max, fee} amount-based fee tiers, e.g. a load of 100-500 -> fee 10. max: null means unbounded upward. First matching tier (by array order) wins. Empty array means untiered -- default_fee is the flat fee. Validated at the app layer.';
comment on column public.services.unit_prices is 'Only meaningful when pricing_mode = per_unit: an array of {label, price} objects, e.g. [{"label":"Black & White","price":3},{"label":"Colored","price":5}]. Selling one variant sets fee = quantity x price and principal = 0 (the whole amount is income - no wallet pass-through, unlike GCash/Maya).';

comment on column public.service_transactions.contact_number is 'Optional: the number the service was for (e.g. mobile number that received the load).';
comment on column public.service_transactions.description is 'Optional free-form note.';
comment on column public.service_transactions.discount_amount is 'Peso amount knocked off a per-unit line''s catalog subtotal (unit_price x unit_quantity) at sale time. fee already reflects this discount -- this column is purely the record of how much was taken off, same role transaction_items.discount_amount plays for products. Always 0 for flat/tiered services.';
comment on column public.service_transactions.payment_account is 'Which account the customer-facing money moved through (box or a wallet). The service''s own wallet leg is the `wallet` column.';
comment on column public.service_transactions.reference is 'Optional: transaction reference from the wallet app (GCash/Maya ref no.).';
comment on column public.service_transactions.tendered is 'Cash handed over (cash-in services paid via the box only). Change = tendered − (principal + fee), always derived.';
comment on column public.service_transactions.unit_label is 'Snapshot of which services.unit_prices variant was sold (and its quantity/price at the time) - null for a flat/tiered service. Never re-derived from the live service row, same reasoning transaction_items snapshots product name/price: a later price change must not rewrite past sales.';
comment on column public.service_transactions.voided_at is 'Set when a cashier voids a mistaken e-service transaction. Every vault_entries row this transaction originally posted gets a reversing "void" row via void_service_transaction() — this column and those rows are the only trace; the original rows are never edited or deleted.';
