-- Ralph POS — optional detail fields on service transactions.
--
-- For a GCash load these are the customer's mobile number and the app's
-- transaction reference — the two things you need when a customer comes back
-- claiming the load never arrived. All three are optional free text.

alter table public.service_transactions
  add column contact_number text,
  add column reference text,
  add column description text;

comment on column public.service_transactions.contact_number is
  'Optional: the number the service was for (e.g. mobile number that received the load).';
comment on column public.service_transactions.reference is
  'Optional: transaction reference from the wallet app (GCash/Maya ref no.).';
comment on column public.service_transactions.description is
  'Optional free-form note.';

drop function public.record_service(uuid, numeric, numeric, public.money_account);

create function public.record_service(
  p_service_id uuid,
  p_principal numeric,
  p_fee numeric,
  p_payment_account public.money_account default 'cash',
  p_contact_number text default null,
  p_reference text default null,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name       text;
  v_flow       public.cash_flow;
  v_wallet     public.money_account;
  v_id         uuid;
  v_pay_delta  numeric(12, 2);
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

  select s.name, s.cash_flow, s.wallet into v_name, v_flow, v_wallet
  from public.services s
  where s.id = p_service_id and s.is_active;

  if not found then
    raise exception 'Service not found or inactive';
  end if;

  insert into public.service_transactions
    (service_id, service_name, cash_flow, principal, fee, wallet, payment_account,
     contact_number, reference, description)
  values
    (p_service_id, v_name, v_flow, p_principal, p_fee, v_wallet, p_payment_account,
     nullif(trim(coalesce(p_contact_number, '')), ''),
     nullif(trim(coalesce(p_reference, '')), ''),
     nullif(trim(coalesce(p_description, '')), ''))
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

revoke all on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text) from public, anon;
grant execute on function public.record_service(uuid, numeric, numeric, public.money_account, text, text, text) to authenticated;
