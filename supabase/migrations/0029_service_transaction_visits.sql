-- Groups multiple e-service sub-transactions recorded in the same customer
-- visit (e.g. a GCash cash-in followed by a Maya cash-in) under one shared
-- tag, so the transaction list can show them together. No new header table
-- -- each sub-transaction already fully stands on its own (own wallet, own
-- vault_entries, own void), there's nothing to merge; this is purely a
-- display grouping key generated client-side per drawer session.
alter table public.service_transactions
  add column service_visit_id uuid null;

create index idx_service_transactions_visit_id
  on public.service_transactions (service_visit_id)
  where service_visit_id is not null;

drop function public.record_service(
  uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric
);

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
     unit_label, unit_quantity, unit_price, service_visit_id)
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
$function$;

revoke all on function public.record_service(
  uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric, uuid
) from public, anon;

grant execute on function public.record_service(
  uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric, uuid
) to authenticated;
