-- Ralph POS — amount-based fee tiers for services (e.g. a GCash load of
-- ₱100–500 charges a ₱10 fee, ₱501–1000 charges ₱12). Purely a config +
-- checkout-autofill concern: record_service() and service_transactions are
-- untouched, since the fee actually charged is still just a plain number
-- the cashier can always edit — tiers only change what pre-fills it.
--
-- Empty array (the default) means "no tiers configured" — default_fee stays
-- the flat fee for those services, exactly as before this migration.
-- Shape ({min, max, fee} objects, max nullable for an open-ended top tier)
-- is validated at the app layer (app/inventory/serviceActions.ts), same as
-- allowed_payment_accounts already is — this column only enforces that it's
-- actually a JSON array, as cheap defense in depth.

alter table public.services
  add column fee_tiers jsonb not null default '[]'::jsonb;

alter table public.services
  add constraint services_fee_tiers_is_array
  check (jsonb_typeof(fee_tiers) = 'array');

comment on column public.services.fee_tiers is
  'Ordered list of {min, max, fee} amount-based fee tiers, e.g. a load of 100-500 -> fee 10. max: null means unbounded upward. First matching tier (by array order) wins. Empty array means untiered -- default_fee is the flat fee. Validated at the app layer.';
