-- Per-unit e-services (Xerox-style) now get the same quantity-adjuster and
-- discount editor a product line already has in the sale sheet. unit_price
-- and unit_quantity stay the undiscounted catalog snapshot (same reasoning
-- as transaction_items) -- discount_amount is the separate, explicit
-- markdown, and fee is the actual post-discount amount that determines
-- income and vault movement, exactly like line_total already does for
-- products.
alter table public.service_transactions
  add column discount_amount numeric(12, 2) not null default 0;

alter table public.service_transactions
  add constraint service_transactions_discount_amount_check
  check (discount_amount >= 0);

comment on column public.service_transactions.discount_amount is
  'Peso amount knocked off a per-unit line''s catalog subtotal (unit_price x unit_quantity) at sale time. fee already reflects this discount -- this column is purely the record of how much was taken off, same role transaction_items.discount_amount plays for products. Always 0 for flat/tiered services.';

drop function public.record_service(
  uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric, uuid
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
  p_visit_id uuid default null::uuid,
  p_discount_amount numeric default 0
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
$function$;

revoke all on function public.record_service(
  uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric, uuid, numeric
) from public, anon;

grant execute on function public.record_service(
  uuid, numeric, numeric, public.money_account, text, text, text, numeric, boolean, text, integer, numeric, uuid, numeric
) to authenticated;

-- record_visit()'s own signature is unchanged -- only the body needs to
-- forward each service line's discount_amount through to record_service().
create or replace function public.record_visit(
  p_items jsonb default null::jsonb,
  p_payment_method public.money_account default null::public.money_account,
  p_tendered numeric default null::numeric,
  p_personal_take boolean default false,
  p_services jsonb default null::jsonb
)
returns uuid
language plpgsql
set search_path to ''
as $function$
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
$function$;
