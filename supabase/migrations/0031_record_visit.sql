-- Atomically records one customer visit that can mix a product cart with
-- any number of e-service lines (e.g. a Coke plus a GCash cash-in), all in
-- a single database transaction: if any line fails validation, nothing
-- commits. This composes the two already-existing, already-tested
-- functions (checkout(), record_service()) rather than duplicating their
-- logic -- calling them from within this function body keeps everything in
-- one Postgres transaction for free, no explicit savepoints needed.
create function public.record_visit(
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
        p_visit_id := v_visit_id
      );
    end loop;
  end if;

  return v_visit_id;
end;
$function$;

revoke all on function public.record_visit(jsonb, public.money_account, numeric, boolean, jsonb) from public, anon;
grant execute on function public.record_visit(jsonb, public.money_account, numeric, boolean, jsonb) to authenticated;
