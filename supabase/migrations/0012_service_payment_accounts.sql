-- Ralph POS — configurable payment methods per service.
--
-- Rationale (owner decision): a GCash Cash-in only makes sense paid in
-- physical cash — letting a customer "pay" a load with GCash itself is
-- incoherent. But this must not be hard-coded: the owner wants to add
-- services later where more than one payment method is genuinely valid, so
-- the allowed set lives as data on each service and is editable in the
-- Inventory → Services form, not baked into application logic.

alter table public.services
  add column allowed_payment_accounts public.money_account[]
  not null default '{cash}';

alter table public.services
  add constraint services_allowed_payment_accounts_check
  check (cardinality(allowed_payment_accounts) > 0);

comment on column public.services.allowed_payment_accounts is
  'Which vault accounts a customer may pay through (cash_flow=in) or be paid from (cash_flow=out) for this service. Enforced server-side by record_service() — the client cannot submit a disallowed account. Defaults to cash-only; widen per service as needed.';

-- record_service(): now validates p_payment_account against the service's
-- own allowed set. Same signature as before, so CREATE OR REPLACE in place —
-- no drop/recreate, ACLs are preserved (re-asserted below for certainty).

create or replace function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric,
  p_payment_account public.money_account default 'cash',
  p_contact_number text default null,
  p_reference text default null,
  p_description text default null,
  p_tendered numeric default null
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
     contact_number, reference, description, tendered)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account,
     nullif(trim(coalesce(p_contact_number, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_description, '')), ''),
     p_tendered)
  returning id into v_id;

  if v_flow = 'in' then
    v_pay_delta    := p_principal + p_fee;
    v_wallet_delta := -p_principal;
  else
    v_pay_delta    := -p_principal;
    v_wallet_delta := p_principal + p_fee;
  end if;

  if v_pay_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
    values ('service', v_pay_delta, v_id, p_payment_account);
  end if;

  if v_wallet is not null and v_wallet_delta <> 0 then
    insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
    values ('service', v_wallet_delta, v_id, v_wallet);
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text, numeric) to authenticated;
