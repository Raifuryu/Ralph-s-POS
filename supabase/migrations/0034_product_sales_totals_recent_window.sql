-- Ralph POS — narrow product_sales_totals to a rolling 3-day window, so the
-- checkout "quick pick" chips track what's actually selling right now
-- instead of surfacing the same all-time best-sellers forever. `now()` is
-- evaluated fresh on every query (views aren't materialized), so the window
-- itself slides day to day with no maintenance.

create or replace view public.product_sales_totals
with (security_invoker = true) as
select ti.product_id, sum(ti.quantity) as units_sold
from public.transaction_items ti
join public.transactions t on t.id = ti.transaction_id
where ti.product_id is not null
  and not t.is_personal_take
  and t.voided_at is null
  and t.created_at >= now() - interval '3 days'
group by ti.product_id;

comment on view public.product_sales_totals is
  'Units sold per product in the trailing 3 days (rolling window, re-evaluated on every query) — powers the checkout quick-pick chips. Excludes personal takes and voided sales. Products with no recent sales simply do not appear.';
