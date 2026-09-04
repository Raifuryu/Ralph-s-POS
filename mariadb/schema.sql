-- Ralph POS — MariaDB schema (port of supabase/schema.sql, MariaDB 10.7+).
--
-- Translation notes (see the migration plan for the full mapping):
--   * UUID columns are CHAR(36), not MariaDB's native UUID type — mysql2 is a
--     MySQL-protocol driver and native UUID support across driver versions is
--     not reliable enough to bet on; CHAR(36) is universally safe and the
--     storage overhead is irrelevant at this app's scale. All UUIDs are
--     generated in TypeScript (crypto.randomUUID()), never DB-side.
--   * Postgres named enum types are inlined as ENUM(...) per column — MariaDB
--     has no standalone named-type equivalent.
--   * "text" columns used for names (need indexing/uniqueness) become
--     VARCHAR(255); MariaDB can't fully index/unique a TEXT column without a
--     prefix length, so free-text description/note/reason fields stay TEXT
--     and name-like fields become VARCHAR.
--   * auth.uid() defaults are gone entirely — every cashier_id/created_by is
--     now NOT NULL with no default; the app must supply it explicitly from
--     the session on every insert.
--   * RLS, grants, and the rls_auto_enable() event trigger are dropped —
--     there is exactly one app-level DB credential; "who can do what" is
--     enforced by the login gate + explicit user-id params, not by Postgres
--     row policies.

SET NAMES utf8mb4;

-- =============================================================================
-- users — replaces Supabase's auth.users. Local-only accounts; no signup UI,
-- provisioned via scripts/seed-user.ts, same as accounts were previously
-- provisioned outside the app via the Supabase dashboard.
-- =============================================================================

CREATE TABLE users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_username_key UNIQUE (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- categories
-- =============================================================================

CREATE TABLE categories (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT categories_name_key UNIQUE (name),
  CONSTRAINT categories_name_check CHECK (LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- products
-- =============================================================================

CREATE TABLE products (
  id                   CHAR(36)       NOT NULL PRIMARY KEY,
  name                 VARCHAR(255)   NOT NULL,
  price                DECIMAL(10,2)  NOT NULL,
  stock                INT,
  is_active            BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  description          TEXT,
  category_id          CHAR(36),
  low_stock_threshold  INT,
  cost                 DECIMAL(12,2),
  expiry_date          DATE,
  CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT products_cost_nonnegative CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT products_low_stock_threshold_nonnegative CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0),
  CONSTRAINT products_name_check CHECK (LENGTH(TRIM(name)) > 0),
  CONSTRAINT products_price_check CHECK (price >= 0),
  INDEX products_active_name_idx (name),
  INDEX products_category_id_idx (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- product_restocks
-- =============================================================================

CREATE TABLE product_restocks (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  product_id   CHAR(36),
  product_name VARCHAR(255)  NOT NULL,
  quantity     INT           NOT NULL,
  cost         DECIMAL(12,2) NOT NULL,
  note         TEXT,
  cashier_id   CHAR(36)      NOT NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_restocks_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT product_restocks_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT product_restocks_cost_check CHECK (cost >= 0),
  CONSTRAINT product_restocks_quantity_check CHECK (quantity > 0),
  INDEX product_restocks_created_at_idx (created_at DESC),
  INDEX product_restocks_product_id_idx (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- services
-- =============================================================================

CREATE TABLE services (
  id                        CHAR(36)      NOT NULL PRIMARY KEY,
  name                      VARCHAR(255)  NOT NULL,
  cash_flow                 ENUM('in','out') NOT NULL DEFAULT 'in',
  default_fee               DECIMAL(10,2),
  is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  wallet                    ENUM('cash','gcash','maya'),
  allowed_payment_accounts  JSON          NOT NULL DEFAULT '["cash"]',
  fee_tiers                 JSON          NOT NULL DEFAULT '[]',
  pricing_mode              ENUM('flat','per_unit') NOT NULL DEFAULT 'flat',
  unit_prices               JSON,
  CONSTRAINT services_name_key UNIQUE (name),
  CONSTRAINT services_allowed_payment_accounts_check CHECK (JSON_LENGTH(allowed_payment_accounts) > 0),
  CONSTRAINT services_default_fee_check CHECK (default_fee IS NULL OR default_fee >= 0),
  CONSTRAINT services_fee_tiers_is_array CHECK (JSON_TYPE(fee_tiers) = 'ARRAY'),
  CONSTRAINT services_name_check CHECK (LENGTH(TRIM(name)) > 0),
  CONSTRAINT services_per_unit_no_wallet_check CHECK (pricing_mode = 'flat' OR wallet IS NULL),
  CONSTRAINT services_pricing_mode_check CHECK (
    (pricing_mode = 'flat' AND unit_prices IS NULL)
    OR (pricing_mode = 'per_unit' AND unit_prices IS NOT NULL AND JSON_TYPE(unit_prices) = 'ARRAY' AND JSON_LENGTH(unit_prices) > 0)
  ),
  CONSTRAINT services_wallet_check CHECK (wallet IS NULL OR wallet <> 'cash')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- transactions
-- =============================================================================

CREATE TABLE transactions (
  id                 CHAR(36)      NOT NULL PRIMARY KEY,
  payment_method     ENUM('cash','gcash','maya'),
  cashier_id         CHAR(36)      NOT NULL,
  total              DECIMAL(12,2) NOT NULL,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tendered           DECIMAL(12,2),
  is_personal_take   BOOLEAN       NOT NULL DEFAULT FALSE,
  voided_at          TIMESTAMP     NULL,
  voided_by          CHAR(36),
  void_reason        TEXT,
  visit_id           CHAR(36),
  -- Personal-take-only ("Utang"): who took it and why, and — once they've
  -- paid it back — when and by whom that was recorded. Never meaningful on
  -- a real sale; nothing enforces that beyond convention, same as
  -- void_reason/voided_by only being meaningful on a voided row.
  debtor_name        VARCHAR(255),
  debtor_description TEXT,
  settled_at         TIMESTAMP     NULL,
  settled_by         CHAR(36),
  CONSTRAINT transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT transactions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT transactions_settled_by_fkey FOREIGN KEY (settled_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT transactions_tendered_check CHECK (tendered IS NULL OR (payment_method = 'cash' AND tendered >= total)),
  CONSTRAINT transactions_personal_take_payment_check CHECK (is_personal_take = (payment_method IS NULL)),
  CONSTRAINT transactions_personal_take_tendered_check CHECK (payment_method IS NOT NULL OR tendered IS NULL),
  CONSTRAINT transactions_total_check CHECK (total >= 0),
  CONSTRAINT transactions_void_fields_check CHECK (voided_at IS NOT NULL OR (voided_by IS NULL AND void_reason IS NULL)),
  CONSTRAINT transactions_settled_fields_check CHECK (settled_at IS NOT NULL OR settled_by IS NULL),
  CONSTRAINT transactions_settled_personal_take_check CHECK (settled_at IS NULL OR is_personal_take = TRUE),
  INDEX idx_transactions_visit_id (visit_id),
  INDEX transactions_cashier_id_idx (cashier_id),
  INDEX transactions_created_at_idx (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- transaction_items
-- =============================================================================

CREATE TABLE transaction_items (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  transaction_id   CHAR(36)      NOT NULL,
  product_id       CHAR(36),
  product_name     VARCHAR(255)  NOT NULL,
  unit_price       DECIMAL(10,2) NOT NULL,
  quantity         INT           NOT NULL,
  unit_cost        DECIMAL(12,2),
  discount_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  surcharge_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total       DECIMAL(12,2) GENERATED ALWAYS AS ((unit_price * quantity) + surcharge_amount - discount_amount) STORED,
  CONSTRAINT transaction_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT transaction_items_discount_amount_check CHECK (discount_amount >= 0),
  CONSTRAINT transaction_items_discount_not_exceed_subtotal_check CHECK (discount_amount <= (unit_price * quantity)),
  CONSTRAINT transaction_items_surcharge_amount_check CHECK (surcharge_amount >= 0),
  CONSTRAINT transaction_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT transaction_items_unit_cost_nonnegative CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT transaction_items_unit_price_check CHECK (unit_price >= 0),
  INDEX transaction_items_product_idx (product_id),
  INDEX transaction_items_txn_id_idx (transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- service_transactions
-- =============================================================================

CREATE TABLE service_transactions (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  service_id       CHAR(36),
  service_name     VARCHAR(255)  NOT NULL,
  cash_flow        ENUM('in','out') NOT NULL,
  principal        DECIMAL(12,2) NOT NULL,
  fee              DECIMAL(10,2) NOT NULL,
  cashier_id       CHAR(36)      NOT NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  wallet           ENUM('cash','gcash','maya'),
  payment_account  ENUM('cash','gcash','maya') NOT NULL,
  contact_number   TEXT,
  reference        TEXT,
  description      TEXT,
  tendered         DECIMAL(12,2),
  voided_at        TIMESTAMP     NULL,
  voided_by        CHAR(36),
  void_reason      TEXT,
  unit_label       TEXT,
  unit_quantity    INT,
  unit_price       DECIMAL(12,2),
  visit_id         CHAR(36),
  discount_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  surcharge_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT service_transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT service_transactions_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
  CONSTRAINT service_transactions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT service_transactions_principal_fee_check CHECK ((principal + fee) > 0),
  CONSTRAINT service_transactions_tendered_check CHECK (
    tendered IS NULL OR (cash_flow = 'in' AND payment_account = 'cash' AND tendered >= (principal + fee))
  ),
  CONSTRAINT service_transactions_discount_amount_check CHECK (discount_amount >= 0),
  CONSTRAINT service_transactions_surcharge_amount_check CHECK (surcharge_amount >= 0),
  CONSTRAINT service_transactions_fee_check CHECK (fee >= 0),
  CONSTRAINT service_transactions_principal_check CHECK (principal >= 0),
  CONSTRAINT service_transactions_unit_fields_check CHECK (
    (unit_label IS NULL AND unit_quantity IS NULL AND unit_price IS NULL)
    OR (unit_label IS NOT NULL AND LENGTH(TRIM(unit_label)) > 0 AND unit_quantity IS NOT NULL AND unit_quantity > 0 AND unit_price IS NOT NULL AND unit_price >= 0)
  ),
  CONSTRAINT service_transactions_void_fields_check CHECK (voided_at IS NOT NULL OR (voided_by IS NULL AND void_reason IS NULL)),
  CONSTRAINT service_transactions_wallet_check CHECK (wallet IS NULL OR wallet <> 'cash'),
  INDEX idx_service_transactions_visit_id (visit_id),
  INDEX service_transactions_created_at_idx (created_at DESC),
  INDEX service_transactions_service_id_idx (service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- wallets — owner-created buckets beyond the fixed Cash/GCash/Maya accounts
-- and Profit/For Restock funds ("the default 5"). Behaves like a fund, not a
-- physical account: never a checkout payment method (see
-- vault_entries.wallet_id's own comment below), just a purpose-based lens on
-- money that's transferred into/out of it and can pay for a restock
-- directly. Kept as its own table rather than folded into the fixed
-- `fund` ENUM — the whole point is an open-ended, owner-managed list, not a
-- second closed pair. `is_active` false means "archived": it drops out of
-- every transfer/restock picker, but its id/name/history stay intact (a
-- FOREIGN KEY from vault_entries, not a delete) so past entries still
-- resolve to a real name instead of an orphaned id.
-- =============================================================================

CREATE TABLE wallets (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(50)  NOT NULL,
  color      VARCHAR(20)  NOT NULL DEFAULT '#6b7280',
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_by CHAR(36)     NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT wallets_name_unique UNIQUE (name),
  CONSTRAINT wallets_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- vault_entries
-- =============================================================================

CREATE TABLE vault_entries (
  id                     CHAR(36)      NOT NULL PRIMARY KEY,
  seq                    BIGINT        NOT NULL AUTO_INCREMENT,
  entry_type             ENUM('sale','service','deposit','withdrawal','count','void','adjustment','transfer') NOT NULL,
  amount                 DECIMAL(12,2) NOT NULL,
  expected               DECIMAL(12,2),
  transaction_id         CHAR(36),
  service_transaction_id CHAR(36),
  note                   TEXT,
  created_by             CHAR(36)      NOT NULL,
  created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account                ENUM('cash','gcash','maya') NOT NULL,
  -- Which of the two Vault "funds" this entry counts toward — an ORTHOGONAL
  -- dimension to `account` above, not a second physical location: the same
  -- peso is always in exactly one real account (cash/gcash/maya) AND,
  -- separately, earmarked for one purpose. Named `fund` rather than
  -- "wallet" specifically to avoid colliding with the pre-existing, unrelated
  -- MoneyAccount-typed "wallet" concept already used elsewhere (services.wallet,
  -- service_transactions.wallet) — this is not that. NULL for entries with
  -- no real earmarking (a 'count' reading, a manual 'adjustment', the
  -- pass-through principal leg of a service). See vault_fund_balance below
  -- for the summed-by-fund view.
  fund                   ENUM('profit','reinvest'),
  -- Which owner-created wallet this entry counts toward — a THIRD dimension
  -- alongside `account`/`fund` above, same "earmarked, not a physical
  -- location" idea `fund` already follows, just for an open-ended list
  -- instead of a fixed pair (see wallets' own comment above). Never set
  -- together with `fund` (vault_entries_fund_wallet_check below) — an entry
  -- is earmarked for at most one of a built-in fund or a custom wallet, never
  -- both. NULL `account` isn't an option (NOT NULL), so a wallet-earmarked
  -- row still carries the same 'cash' placeholder convention `fund` rows use.
  wallet_id              CHAR(36),
  -- Correlates a 'transfer' row with its OTHER leg — the two rows one split
  -- posts (see the CHECK's own comment below) share one transfer_group,
  -- generated fresh per split. NULL for every other entry_type. Exists
  -- specifically so a wallet's leaving leg (wallet_id set) can be told
  -- apart from one that reached a real account (transferWalletToAccounts/
  -- transferWalletsToAccount — its sibling arriving leg has fund AND
  -- wallet_id both NULL) versus one that reached a fund (transferWalletToFunds
  -- — sibling has fund set) or another wallet (transferWalletToWallets —
  -- sibling has wallet_id set too): the leaving leg's own columns look
  -- identical in all three cases (wallet_id set, account either the real
  -- destination or a 'cash' placeholder depending which), so only a join
  -- back to the sibling via transfer_group can tell them apart. A fund's
  -- own leaving leg never needs this (transferFund/transferFundsToAccount
  -- are the only fund-leaving-leg source, and always land on a real
  -- account), but every transfer-posting function sets it anyway for
  -- consistency.
  transfer_group         CHAR(36),
  CONSTRAINT vault_entries_seq_key UNIQUE (seq),
  CONSTRAINT vault_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT vault_entries_service_transaction_id_fkey FOREIGN KEY (service_transaction_id) REFERENCES service_transactions(id) ON DELETE SET NULL,
  CONSTRAINT vault_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  CONSTRAINT vault_entries_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
  CONSTRAINT vault_entries_fund_wallet_check CHECK (fund IS NULL OR wallet_id IS NULL),
  CONSTRAINT vault_entries_type_amount_check CHECK (
    (entry_type = 'count' AND amount >= 0 AND expected IS NOT NULL)
    OR (entry_type = 'sale' AND amount > 0)
    OR (entry_type = 'deposit' AND amount > 0)
    OR (entry_type = 'withdrawal' AND amount < 0)
    OR (entry_type = 'service' AND amount <> 0)
    OR (entry_type = 'void' AND amount <> 0)
    OR (entry_type = 'adjustment' AND amount <> 0)
    -- Two rows per transfer, opposite signs — the fund-leaving leg
    -- (negative, fund set) and the account-arriving leg (positive, fund
    -- NULL). See vault_balance/vault_fund_balance's own comments.
    OR (entry_type = 'transfer' AND amount <> 0)
  ),
  CONSTRAINT vault_entries_withdrawal_note_check CHECK (entry_type <> 'withdrawal' OR LENGTH(TRIM(COALESCE(note, ''))) > 0),
  INDEX vault_entries_account_seq_idx (account, seq DESC),
  INDEX vault_entries_seq_idx (seq DESC),
  INDEX vault_entries_wallet_id_seq_idx (wallet_id, seq DESC),
  INDEX vault_entries_transfer_group_idx (transfer_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- vault_snapshots — a manually-confirmed "whole vault" checkpoint: what was
-- physically counted across all 3 accounts, plus that store-day's profit so
-- far, both entered/computed together in one action (see AccountSheet's
-- Adjust tab for per-account corrections instead — this table is for the
-- combined picture, not individual balances). One row per store-day
-- (UNIQUE(snapshot_day)) — recording a second snapshot the same day just
-- overwrites the first via ON DUPLICATE KEY UPDATE, so the latest count
-- always wins rather than piling up several same-day readings.
-- =============================================================================

CREATE TABLE vault_snapshots (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  snapshot_day DATE          NOT NULL,
  cash_amount  DECIMAL(12,2) NOT NULL,
  gcash_amount DECIMAL(12,2) NOT NULL,
  maya_amount  DECIMAL(12,2) NOT NULL,
  total_money  DECIMAL(12,2) NOT NULL,
  profit       DECIMAL(12,2) NOT NULL,
  -- Gross revenue (store + e-service, before cost) for that store-day —
  -- added after `profit`, so rows recorded before this column existed are
  -- NULL rather than a guessed/backfilled 0; the History row shows that gap
  -- honestly instead of implying a $0 income day.
  income       DECIMAL(12,2),
  created_by   CHAR(36)      NOT NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT vault_snapshots_day_key UNIQUE (snapshot_day),
  CONSTRAINT vault_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT vault_snapshots_amounts_check CHECK (
    cash_amount >= 0 AND gcash_amount >= 0 AND maya_amount >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- store_settings — a single row of small owner-configurable settings that
-- don't belong to any one entity. Baseline Fund's own maintained target is
-- the first (and so far only) one — see setBaselineFundTarget's own doc
-- comment for what it drives. Fixed id=1, enforced by the CHECK below,
-- rather than a real key-value table — simplest shape for "there's only
-- ever one row of these." No seed row required: the app upserts on first
-- save (INSERT ... ON DUPLICATE KEY UPDATE), and reads tolerate "no row
-- yet" as "not set."
-- =============================================================================

CREATE TABLE store_settings (
  id                    TINYINT(1)    NOT NULL PRIMARY KEY DEFAULT 1,
  -- The Cash+GCash+Maya total the owner wants maintained — the Sales
  -- dashboard's own Baseline Fund card shows the gap between this and the
  -- live total (red when short). NULL means no target set yet, hides that
  -- note entirely.
  baseline_fund_target  DECIMAL(12,2),
  updated_by            CHAR(36),
  updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT store_settings_single_row_check CHECK (id = 1),
  CONSTRAINT store_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT store_settings_target_nonnegative CHECK (baseline_fund_target IS NULL OR baseline_fund_target >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Views
-- =============================================================================

-- Units sold per product in the trailing 3 days (rolling window, re-evaluated
-- on every query) — powers the checkout quick-pick chips. Excludes personal
-- takes and voided sales.
CREATE VIEW product_sales_totals AS
SELECT ti.product_id, SUM(ti.quantity) AS units_sold
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
WHERE ti.product_id IS NOT NULL
  AND NOT t.is_personal_take
  AND t.voided_at IS NULL
  AND t.created_at >= NOW() - INTERVAL 3 DAY
GROUP BY ti.product_id;

-- One row per money account: balance = latest 'count' entry for that account
-- + every non-count movement posted after it. Postgres's version used
-- unnest(enum_range()) + LEFT JOIN LATERAL; MariaDB gets the same result via
-- a 3-row literal account list + a correlated subquery for "the latest count"
-- and another for "movements since it".
--
-- `v.fund IS NULL AND v.wallet_id IS NULL` is the key exclusion: a
-- 'sale'/'service'/settlement entry with a fund or wallet set represents
-- money earmarked for Profit/Reinvest/a custom wallet, not yet physically in
-- this account — it only reaches Cash/GCash/Maya via an explicit 'transfer'
-- (see wallet_balance/vault_fund_balance below), whose account-arriving leg
-- is itself posted with both fund and wallet_id NULL. So this account
-- balance means "money actually transferred/deposited here," not
-- "everything ever sold through this payment method" — see
-- vault_entries.fund/wallet_id's own comments.
--
-- The literals below are COLLATE-pinned explicitly — a view's string
-- literals otherwise freeze whatever collation_connection happened to be in
-- effect the moment CREATE VIEW ran, not the querying session's own
-- collation, which caused a real "Illegal mix of collations" error once
-- anything outside the view (e.g. a bound `?` parameter, correctly
-- utf8mb4_unicode_ci per lib/mysql/pool.ts's SET NAMES) got compared
-- against acct.account. Pinning it here makes the view's own output
-- collation-stable regardless of session state at creation time.
CREATE VIEW vault_balance AS
SELECT
  acct.account,
  CAST(
    COALESCE(lc.amount, 0) + COALESCE((
      SELECT SUM(v.amount)
      FROM vault_entries v
      WHERE v.entry_type <> 'count'
        AND v.fund IS NULL
        AND v.wallet_id IS NULL
        AND v.account = acct.account
        AND v.seq > COALESCE(lc.seq, 0)
    ), 0)
  AS DECIMAL(12,2)) AS balance,
  lc.created_at AS last_counted_at
FROM (
  SELECT 'cash' COLLATE utf8mb4_unicode_ci AS account
  UNION ALL SELECT 'gcash' COLLATE utf8mb4_unicode_ci
  UNION ALL SELECT 'maya' COLLATE utf8mb4_unicode_ci
) acct
LEFT JOIN (
  SELECT ve.account, ve.amount, ve.seq, ve.created_at
  FROM vault_entries ve
  WHERE ve.entry_type = 'count'
    AND ve.seq = (
      SELECT MAX(ve2.seq)
      FROM vault_entries ve2
      WHERE ve2.entry_type = 'count' AND ve2.account = ve.account
    )
) lc ON lc.account = acct.account;

-- The mirror image of vault_balance, for the two Vault "funds" instead of
-- the three physical accounts — no count/anchor mechanism needed here (a
-- fund isn't something you physically count), just a plain sum. Includes
-- every entry with that fund set, regardless of what `account` says (that
-- column is just "where this money originally came from/is headed," not
-- part of the fund balance itself) — sale/service/settlement postings, void
-- reversals, and the fund-leaving leg of a 'transfer'.
CREATE VIEW vault_fund_balance AS
SELECT
  f.fund,
  CAST(COALESCE(SUM(ve.amount), 0) AS DECIMAL(12,2)) AS balance
FROM (
  SELECT 'profit' COLLATE utf8mb4_unicode_ci AS fund
  UNION ALL SELECT 'reinvest' COLLATE utf8mb4_unicode_ci
) f
LEFT JOIN vault_entries ve ON ve.fund = f.fund
GROUP BY f.fund;

-- One row per wallet, active or not — a deactivated wallet keeps its balance
-- reachable (its history isn't erased, see wallets' own comment), it just
-- drops out of the transfer/restock pickers, which filter on is_active
-- themselves. Same "plain SUM, no count/anchor" shape as vault_fund_balance
-- above — a wallet isn't something you physically count either.
CREATE VIEW wallet_balance AS
SELECT
  w.id AS wallet_id,
  w.name,
  w.color,
  w.is_active,
  CAST(COALESCE(SUM(ve.amount), 0) AS DECIMAL(12,2)) AS balance
FROM wallets w
LEFT JOIN vault_entries ve ON ve.wallet_id = w.id
GROUP BY w.id, w.name, w.color, w.is_active;
