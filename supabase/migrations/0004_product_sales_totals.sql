-- Ralph POS — per-product sales totals, for "top selling items" in the UI.
--
-- A view rather than client-side aggregation: the dashboard only loads the
-- most recent 100 transactions (and may be filtered), so summing in the
-- browser would rank on a biased sample. This ranks over all history.
--
-- `security_invoker = true` is required: views otherwise run as their owner
-- (postgres, which bypasses RLS), turning the view into an RLS hole. With
-- invoker rights the caller needs its own grant + RLS policy on
-- transaction_items, both of which `authenticated` has.

create view public.product_sales_totals
with (security_invoker = true) as
select
  product_id,
  sum(quantity)::bigint as units_sold
from public.transaction_items
where product_id is not null
group by product_id;

comment on view public.product_sales_totals is
  'Units sold per product across all history. Rows keyed by product_id; products never sold do not appear.';

-- Supabase default privileges grant ALL on new relations to anon and
-- authenticated (see 0002) — trim to what the app uses.
revoke all on table public.product_sales_totals from anon;
grant select on table public.product_sales_totals to authenticated;
