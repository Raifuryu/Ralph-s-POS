-- Ralph POS — new vault_entries entry_type for void reversals (see the
-- immediately-following migration for why: 'sale' is fixed positive, so a
-- void reversal can't reuse it without violating the existing check).
-- Split into its own migration because Postgres requires a new enum value
-- to be committed before it can be referenced by a check constraint.

alter type public.vault_entry_type add value if not exists 'void';
