-- Ralph POS — optional per-product expiry date, surfaced in the inventory
-- list as items approach or pass it. NULL means "doesn't expire."
--
-- Reconciliation note: this exact statement was already applied live on
-- 2026-07-28 (migration version 20260728001307); this file was added
-- afterward so the on-disk history matches what's actually in the database.

alter table public.products
  add column expiry_date date null;
