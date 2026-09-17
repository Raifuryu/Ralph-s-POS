# TODO

## Done: restock history now shows which wallet/fund/account paid, and the owner's own-money gap

Requested 2026-09-17, implemented same day.

- Added `restock_batch CHAR(36)` to both `product_restocks` and `vault_entries` (see their own comments in `mariadb/schema.sql`) — generated once per `recordBulkRestock()` call and stamped on every line it inserts and every payment `vault_entries` row it posts, so a receipt and its payment rows can be correlated exactly.
- `app/inventory/page.tsx` groups restock rows into receipts by `restock_batch` when present, falling back to the old cashier+timestamp heuristic only for rows written before this column existed (`restock_batch IS NULL`). A follow-up query fetches the payment `vault_entries` rows for exactly the batches shown, and `attachPayments()` turns them into each receipt's `paymentBreakdown` plus an inferred `ownerCovered` (= totalCost − whatever was actually logged as paid, floored at 0 — never computed for a legacy/unbatched receipt, since there's no way to tell "owner paid" apart from "payment wasn't logged" without the correlation).
- `app/inventory/restockHistorySheet.tsx` shows a "Paid: …" summary in the collapsed row and a full "Paid with" breakdown (plus an "Owner (out of pocket)" line when relevant) in the expanded one.

**Needs a migration on the live DB** — this is a new column on two existing tables, not yet applied outside this session:

```sql
ALTER TABLE product_restocks
  ADD COLUMN restock_batch CHAR(36) AFTER created_at,
  ADD INDEX product_restocks_restock_batch_idx (restock_batch);

ALTER TABLE vault_entries
  ADD COLUMN restock_batch CHAR(36) AFTER transfer_group,
  ADD INDEX vault_entries_restock_batch_idx (restock_batch);
```

No backfill needed — existing rows just read as `restock_batch = NULL` (legacy, ungrouped-by-batch, no payment breakdown shown), which is exactly what the fallback logic expects.
