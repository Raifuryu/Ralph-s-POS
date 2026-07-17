-- Ralph POS — revoke privileges Supabase grants by default
--
-- Why this exists:
--   Supabase ships `alter default privileges in schema public grant all on
--   tables to anon, authenticated, service_role` (and `execute` on functions).
--   Every new table in `public` therefore starts with FULL privileges for anon
--   and authenticated — including DELETE and TRUNCATE. The restrictive GRANTs
--   in 0001 were no-ops: they granted a subset of what was already granted.
--
--   Nothing was exposed, because RLS is enabled and the policies are all
--   `to authenticated` (so anon matches none), and there is no UPDATE/DELETE
--   policy on the history tables (so RLS denies those). But that left RLS as
--   the *only* layer. Disabling RLS on a table, or adding one permissive
--   policy, would hand anon DELETE/TRUNCATE on the sales history.
--
--   Revoking makes the intended access model true at the grant layer too, so
--   the two layers have to fail together rather than one.
--
-- Note: `revoke ... from public` does NOT remove these, because the default
-- privileges grant to anon/authenticated *explicitly*, not via PUBLIC.

-- ---------------------------------------------------------------------------
-- anon has no business touching any of these tables.
-- The app only ever reads/writes them as an authenticated user; the login page
-- talks to the `auth` schema, not to `public`.
-- ---------------------------------------------------------------------------

revoke all on table public.products          from anon;
revoke all on table public.transactions      from anon;
revoke all on table public.transaction_items from anon;

-- ---------------------------------------------------------------------------
-- authenticated keeps exactly what the app uses, and nothing more.
-- ---------------------------------------------------------------------------

-- Inventory is managed in-app: select, insert, update, delete stay.
revoke truncate, references, trigger
  on table public.products from authenticated;

-- Sales history is append-only: select + insert only. This is now enforced by
-- BOTH the absent grant and the absent RLS policy.
revoke update, delete, truncate, references, trigger
  on table public.transactions from authenticated;

revoke update, delete, truncate, references, trigger
  on table public.transaction_items from authenticated;

-- ---------------------------------------------------------------------------
-- checkout() must not be callable by anon.
--
-- 0001 ran `revoke all ... from public`, which worked — but anon holds a
-- separate explicit EXECUTE from the default privileges, so it survived.
-- An anon caller cannot complete a sale (auth.uid() is null, so cashier_id
-- violates NOT NULL and the RLS insert policy fails), but it can still reach
-- the `for update` product row locks.
-- ---------------------------------------------------------------------------

revoke all on function public.checkout(public.payment_method, jsonb) from anon;
