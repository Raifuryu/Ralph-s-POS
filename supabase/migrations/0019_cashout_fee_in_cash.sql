-- Ralph POS — a cash-out's fee now posts as its own vault_entries line
-- instead of being folded into the wallet-side transfer or pre-netted into
-- one cash figure.
--
-- Real-world flow: customer sends `principal` via wallet (e.g. GCash) to
-- cash out; the store hands back cash. The fee always comes out of the cash
-- side — whether the customer hands over a round bill and gets change back,
-- or hands over the already-reduced amount directly, the running balance
-- ends up identical (-principal, then +fee). Recording it as two entries
-- keeps that fee-in-cash step visible in the Vault ledger instead of
-- silently netting it away, and keeps `principal` on service_transactions
-- equal to the real transaction size (what actually moved through the
-- wallet) rather than a fee-shrunk number.
--
-- Cash-in is untouched — its fee-included-in-amount adjustment (an opt-in
-- checkbox) is a single clean cash handoff already and doesn't need this.
--
-- Same signature as before, so CREATE OR REPLACE is enough — no DROP
-- FUNCTION, and existing grants carry over untouched.

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

    if v_pay_delta <> 0 then
      insert into public.vault_entries (entry_type, amount, service_transaction_id, account)
      values ('service', v_pay_delta, v_id, p_payment_account);
    end if;

    if v_wallet is not null and v_wallet_delta <> 0 then
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
$$;
