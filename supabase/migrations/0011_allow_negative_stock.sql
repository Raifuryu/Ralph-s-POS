-- Ralph POS — allow overselling: stock may go NEGATIVE.
--
-- Rationale (owner decision): the shelf is the source of truth, not the
-- system. If the cashier is holding the item, the sale must never be blocked
-- because the recorded count is wrong. Selling past the recorded stock drives
-- it negative, which is the reconciliation signal: a negative count means
-- "recount this item" — the history stays honest instead of the cashier
-- working around the system.
--
-- The UI warns (yellow row) and asks for confirmation before an overselling
-- sale is recorded; the database no longer blocks it.
--
-- NULL stock semantics are unchanged: NULL = not tracked at all.

alter table public.products drop constraint products_stock_check;

comment on column public.products.stock is
  'On-hand quantity. NULL = not quantity-tracked. Negative = oversold past the recorded count — recount and correct in Inventory.';
