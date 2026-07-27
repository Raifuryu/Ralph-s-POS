-- Ralph POS — void a mistaken sale/personal-take. Same "corrections are new
-- rows, not edits" philosophy as the rest of this app's history tables: the
-- original transaction/transaction_items/vault_entries rows are never
-- touched. Voiding instead flags the transaction (voided_at) and posts a
-- reversing vault_entries row for the original amount, so the ledger stays
-- a complete, honest trail (both the original sale and its reversal remain
-- visible) instead of silently rewriting history.
--
-- The 'void' vault_entries entry_type this migration relies on was added in
-- 0022 (had to be its own committed migration first).

alter table public.transactions
  add column voided_at timestamptz null,
  add column voided_by uuid null references auth.users (id) on delete restrict,
  add column void_reason text null;

comment on column public.transactions.voided_at is
  'Set when a cashier voids a mistaken sale/take. Stock and any posted vault income are reversed via void_transaction() — this column and the reversing vault_entries row are the only trace; the original rows are never edited or deleted.';

-- Belt-and-suspenders: voided_by/void_reason only make sense together with
-- voided_at, and never without it.
alter table public.transactions
  add constraint transactions_void_fields_check
  check (
    (voided_at is not null) or (voided_by is null and void_reason is null)
  );

-- transactions previously had no UPDATE policy at all (append-only, like
-- every other history table) — voiding is the first legitimate update, so
-- it needs one. Same unrestricted-to-any-staff shape as products/services
-- already have.
create policy "staff void transactions" on public.transactions
  for update to authenticated using (true) with check (true);

-- Reversal entries need their own allowed sign — 'sale' is fixed positive,
-- so a void reversal can't reuse that entry_type without violating the
-- existing check.
alter table public.vault_entries drop constraint vault_entries_check;
alter table public.vault_entries add constraint vault_entries_check check (
  (entry_type = 'count' and amount >= 0 and expected is not null)
  or (entry_type = 'sale' and amount > 0)
  or (entry_type = 'deposit' and amount > 0)
  or (entry_type = 'withdrawal' and amount < 0)
  or (entry_type = 'service' and amount <> 0)
  or (entry_type = 'void' and amount <> 0)
);

-- Excludes voided sales from the top-sellers signal, same as personal takes
-- already are — a voided sale isn't real demand either.
create or replace view public.product_sales_totals
with (security_invoker = true) as
select ti.product_id, sum(ti.quantity) as units_sold
from public.transaction_items ti
join public.transactions t on t.id = ti.transaction_id
where ti.product_id is not null and not t.is_personal_take and t.voided_at is null
group by ti.product_id;

-- void_transaction(): the only way voided_at gets set. Restores each line's
-- stock (a no-op arithmetically for untracked items, since null + n stays
-- null), and for a real sale (not a personal take, which never posted
-- income to begin with) posts a reversing 'void' vault_entries row for the
-- original amount.
create function public.void_transaction(
  p_transaction_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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

  if not v_transaction.is_personal_take then
    insert into public.vault_entries (entry_type, amount, transaction_id, account, note)
    values (
      'void', -v_transaction.total, p_transaction_id, v_transaction.payment_method,
      'Void reversal'
    );
  end if;
end;
$$;

revoke all on function public.void_transaction(uuid, text) from public, anon;
grant execute on function public.void_transaction(uuid, text) to authenticated;
