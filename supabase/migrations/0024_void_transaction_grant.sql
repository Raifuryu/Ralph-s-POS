-- Ralph POS — 0023 added an RLS policy allowing UPDATE on transactions, but
-- (per this project's hardened-grants convention) the base table privilege
-- was never granted, so RLS alone wasn't enough. Column-scoped rather than a
-- blanket UPDATE grant: void_transaction() should be the only way any of
-- transactions' financial fields (total, payment_method, ...) ever change —
-- only the three void-tracking columns are actually grantable here.

grant update (voided_at, voided_by, void_reason) on public.transactions to authenticated;
