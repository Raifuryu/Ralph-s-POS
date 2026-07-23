-- Ralph POS — per-product override for the inventory list's "low stock"
-- indicator threshold. NULL (the default) means "use the store-wide
-- default" (LOW_STOCK_THRESHOLD in app/inventory/itemsBrowser.tsx) — most
-- items never need a custom number, only ones that are normally kept at a
-- handful of units (or normally stocked by the dozen) benefit from their own.

alter table public.products
  add column low_stock_threshold integer null;

alter table public.products
  add constraint products_low_stock_threshold_nonnegative
  check (low_stock_threshold is null or low_stock_threshold >= 0);

comment on column public.products.low_stock_threshold is
  'Per-product override for the inventory list''s "low stock" indicator threshold. NULL means use the store-wide default.';
