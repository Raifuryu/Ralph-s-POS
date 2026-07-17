-- Ralph POS — inventory fields
--
-- Two changes to public.products:
--
-- 1. `stock` becomes nullable. NULL means "this item is not quantity-tracked"
--    — loose goods sold by scoop, sachets from an open pack, services. This is
--    deliberately distinct from 0, which means "tracked, and none left".
--
--    checkout() needs no change: `stock = stock - quantity` on a NULL stays
--    NULL, and `check (stock >= 0)` is not violated by NULL (a CHECK passes
--    unless it evaluates to false). So untracked items neither decrement nor
--    block a sale, which is exactly the intent.
--
-- 2. `description` is added, nullable — free-form notes on the item.

alter table public.products
  alter column stock drop not null,
  alter column stock drop default;

alter table public.products
  add column description text;

comment on column public.products.stock is
  'On-hand quantity. NULL = not quantity-tracked (checkout neither decrements nor blocks). 0 = tracked and out of stock.';

comment on column public.products.description is
  'Optional free-form note about the item.';
