-- Ralph POS — void a mistaken e-service transaction, same shape as
-- void_transaction() for sales (migration 0023): the original row is
-- flagged, never edited, and every vault_entries row it originally posted
-- gets its own reversing 'void' row (not recomputed from principal/fee/
-- cash_flow/wallet — a service can post 2 or 3 entries depending on flow
-- and fee_in_wallet, so mirroring whatever actually exists is simpler and
-- safer than re-deriving the split). No stock to restore — services never
-- touch products.

alter table public.service_transactions
  add column voided_at timestamptz null,
  add column voided_by uuid null references auth.users (id) on delete restrict,
  add column void_reason text null;

comment on column public.service_transactions.voided_at is
  'Set when a cashier voids a mistaken e-service transaction. Every vault_entries row this transaction originally posted gets a reversing "void" row via void_service_transaction() — this column and those rows are the only trace; the original rows are never edited or deleted.';

alter table public.service_transactions
  add constraint service_transactions_void_fields_check
  check (
    (voided_at is not null) or (voided_by is null and void_reason is null)
  );

create policy "staff void service transactions" on public.service_transactions
  for update to authenticated using (true) with check (true);

grant update (voided_at, voided_by, void_reason)
  on public.service_transactions to authenticated;

create function public.void_service_transaction(
  p_service_transaction_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

revoke all on function public.void_service_transaction(uuid, text) from public, anon;
grant execute on function public.void_service_transaction(uuid, text) to authenticated;
