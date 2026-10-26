## PENDING MIGRATION — barcode scanning

Run before deploying. One column, plus the uniqueness that lets a scan
identify exactly one item.

```sql
ALTER TABLE products
  ADD COLUMN barcode VARCHAR(64) AFTER name,
  ADD CONSTRAINT products_barcode_unique UNIQUE (barcode);
```

Existing items get `NULL` (no code yet) — scan each one in Inventory to
assign it. NULL repeats are fine under UNIQUE in MariaDB, so only real
codes have to be distinct.

## PENDING MIGRATION — partial utang payments

Run before deploying. One column: which amount a cart take is owed at, so a
partially-paid balance can't shift under the debtor once payments start.
Defaults to selling price — utang is normally paid back at the shelf price.

```sql
ALTER TABLE transactions
  ADD COLUMN settle_at_selling_price BOOLEAN NOT NULL DEFAULT TRUE AFTER settled_by;
```

**If the column already exists** (added by an earlier run of this with
`DEFAULT FALSE`), the ALTER above will fail as a duplicate — that's fine.
New takes no longer depend on the column default at all: checkout() now
writes the basis explicitly. But takes ALREADY recorded still carry
whatever the old default gave them, so switch the outstanding ones over:

```sql
UPDATE transactions
SET settle_at_selling_price = TRUE
WHERE is_personal_take = 1 AND settled_at IS NULL;
```

That only touches unpaid takes. Anything already part-paid or settled keeps
the amount it was being paid against. To also fix the column's own default
for safety:

```sql
ALTER TABLE transactions ALTER COLUMN settle_at_selling_price SET DEFAULT TRUE;
```

Verify with:

```sql
SELECT COUNT(*) AS ok FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions'
  AND COLUMN_NAME = 'settle_at_selling_price';   -- expect 1
```

Paid-to-date needs no column — it's summed from the vault deposits each
payment posts, so it can't drift from what the vault actually holds.

## Done (migration applied): personal takes now cover e-services, not just products

Requested 2026-10-14, implemented same day. The debtor owes **principal + fee**: recordService posts only the leg that actually left the store (the load it sent, or the cash it handed out) and nothing incoming, so a service take's whole value stays off the books until it's paid — same rule cart takes already follow.

**Needs a migration on the live DB, before deploying** (new columns on `service_transactions`, mirroring the ones `transactions` already has):

```sql
ALTER TABLE service_transactions
  ADD COLUMN is_personal_take   TINYINT(1)   NOT NULL DEFAULT 0 AFTER created_at,
  ADD COLUMN debtor_name        VARCHAR(255) AFTER is_personal_take,
  ADD COLUMN debtor_description TEXT         AFTER debtor_name,
  ADD COLUMN settled_at         TIMESTAMP    NULL AFTER debtor_description,
  ADD COLUMN settled_by         CHAR(36)     AFTER settled_at;

ALTER TABLE service_transactions
  ADD CONSTRAINT service_transactions_settled_by_fkey
    FOREIGN KEY (settled_by) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_transactions_settled_fields_check
    CHECK (settled_at IS NOT NULL OR settled_by IS NULL),
  ADD CONSTRAINT service_transactions_settled_personal_take_check
    CHECK (settled_at IS NULL OR is_personal_take = 1);

ALTER TABLE service_transactions
  DROP CONSTRAINT service_transactions_tendered_check,
  ADD CONSTRAINT service_transactions_tendered_check CHECK (
    tendered IS NULL
    OR (is_personal_take = 0 AND cash_flow = 'in' AND payment_account = 'cash'
        AND tendered >= (principal + fee))
  );
```

Existing rows default to `is_personal_take = 0`, so every service already recorded behaves exactly as before. Run the three statements in order — the CHECKs reference the new column.
