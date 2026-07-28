-- Ralph POS — per-unit pricing for services (Xerox/Photocopy: pick a
-- variant like Black & White vs Colored, type a quantity, fee = qty x
-- price), alongside the existing flat/tiered wallet services (GCash/Maya
-- cash-in/out). Dynamic by design — the variant list is a jsonb array on
-- the service row itself, editable from the same form as GCash's fee
-- tiers, so adding a third print option later needs no code change.

create type public.service_pricing_mode as enum ('flat', 'per_unit');

alter table public.services
  add column pricing_mode public.service_pricing_mode not null default 'flat',
  add column unit_prices jsonb null;

comment on column public.services.unit_prices is
  'Only meaningful when pricing_mode = per_unit: an array of {label, price} objects, e.g. [{"label":"Black & White","price":3},{"label":"Colored","price":5}]. Selling one variant sets fee = quantity x price and principal = 0 (the whole amount is income - no wallet pass-through, unlike GCash/Maya).';

alter table public.services
  add constraint services_pricing_mode_check check (
    (pricing_mode = 'flat' and unit_prices is null)
    or (
      pricing_mode = 'per_unit'
      and unit_prices is not null
      and jsonb_typeof(unit_prices) = 'array'
      and jsonb_array_length(unit_prices) > 0
    )
  );

-- A per-unit service has no e-wallet to move money through - it's a plain
-- "customer pays, store earns" transaction, so wallet must stay unset.
alter table public.services
  add constraint services_per_unit_no_wallet_check check (
    pricing_mode = 'flat' or wallet is null
  );

alter table public.service_transactions
  add column unit_label text null,
  add column unit_quantity integer null,
  add column unit_price numeric(12, 2) null;

comment on column public.service_transactions.unit_label is
  'Snapshot of which services.unit_prices variant was sold (and its quantity/price at the time) - null for a flat/tiered service. Never re-derived from the live service row, same reasoning transaction_items snapshots product name/price: a later price change must not rewrite past sales.';

alter table public.service_transactions
  add constraint service_transactions_unit_fields_check check (
    (unit_label is null and unit_quantity is null and unit_price is null)
    or (
      unit_label is not null and length(trim(unit_label)) > 0
      and unit_quantity is not null and unit_quantity > 0
      and unit_price is not null and unit_price >= 0
    )
  );

-- record_service(): three new trailing params, snapshotted onto the new
-- columns. Everything else is byte-for-byte the same as before - a per-unit
-- sale is just principal=0/fee=quantity*price fed into the exact same
-- wallet-less cash-in path a flat wallet-less service (the old flat Xerox)
-- already used. New params added, so DROP + CREATE (same reason 0020
-- needed it) rather than CREATE OR REPLACE.
drop function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean);

create function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric,
  p_payment_account public.money_account default 'cash'::public.money_account,
  p_contact_number text default null::text,
  p_reference text default null::text,
  p_description text default null::text,
  p_tendered numeric default null::numeric,
  p_fee_in_wallet boolean default false,
  p_unit_label text default null,
  p_unit_quantity integer default null,
  p_unit_price numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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
     unit_label, unit_quantity, unit_price)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account,
     nullif(trim(coalesce(p_contact_number, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_description, '')), ''),
     p_tendered,
     p_unit_label, p_unit_quantity, p_unit_price)
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
    -- Fee paid electronically, embedded in the wallet-side transfer - cash
    -- just hands over the plain principal, wallet absorbs principal+fee.
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
    -- Fee paid in cash, as its own ledger line (default - also the only
    -- option for a wallet-less service, since there's nowhere else for the
    -- fee to land).
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
$$;

revoke all on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric) to authenticated;
