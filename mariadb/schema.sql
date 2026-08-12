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
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  payment_method   ENUM('cash','gcash','maya'),
  cashier_id       CHAR(36)      NOT NULL,
  total            DECIMAL(12,2) NOT NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tendered         DECIMAL(12,2),
  is_personal_take BOOLEAN       NOT NULL DEFAULT FALSE,
  voided_at        TIMESTAMP     NULL,
  voided_by        CHAR(36),
  void_reason      TEXT,
  visit_id         CHAR(36),
  CONSTRAINT transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT transactions_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT transactions_tendered_check CHECK (tendered IS NULL OR (payment_method = 'cash' AND tendered >= total)),
  CONSTRAINT transactions_personal_take_payment_check CHECK (is_personal_take = (payment_method IS NULL)),
  CONSTRAINT transactions_personal_take_tendered_check CHECK (payment_method IS NOT NULL OR tendered IS NULL),
  CONSTRAINT transactions_total_check CHECK (total >= 0),
  CONSTRAINT transactions_void_fields_check CHECK (voided_at IS NOT NULL OR (voided_by IS NULL AND void_reason IS NULL)),
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
-- vault_entries
-- =============================================================================

CREATE TABLE vault_entries (
  id                     CHAR(36)      NOT NULL PRIMARY KEY,
  seq                    BIGINT        NOT NULL AUTO_INCREMENT,
  entry_type             ENUM('sale','service','deposit','withdrawal','count','void') NOT NULL,
  amount                 DECIMAL(12,2) NOT NULL,
  expected               DECIMAL(12,2),
  transaction_id         CHAR(36),
  service_transaction_id CHAR(36),
  note                   TEXT,
  created_by             CHAR(36)      NOT NULL,
  created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account                ENUM('cash','gcash','maya') NOT NULL,
  CONSTRAINT vault_entries_seq_key UNIQUE (seq),
  CONSTRAINT vault_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT vault_entries_service_transaction_id_fkey FOREIGN KEY (service_transaction_id) REFERENCES service_transactions(id) ON DELETE SET NULL,
  CONSTRAINT vault_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  CONSTRAINT vault_entries_type_amount_check CHECK (
    (entry_type = 'count' AND amount >= 0 AND expected IS NOT NULL)
    OR (entry_type = 'sale' AND amount > 0)
    OR (entry_type = 'deposit' AND amount > 0)
    OR (entry_type = 'withdrawal' AND amount < 0)
    OR (entry_type = 'service' AND amount <> 0)
    OR (entry_type = 'void' AND amount <> 0)
  ),
  CONSTRAINT vault_entries_withdrawal_note_check CHECK (entry_type <> 'withdrawal' OR LENGTH(TRIM(COALESCE(note, ''))) > 0),
  INDEX vault_entries_account_seq_idx (account, seq DESC),
  INDEX vault_entries_seq_idx (seq DESC)
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
CREATE VIEW vault_balance AS
SELECT
  acct.account,
  CAST(
    COALESCE(lc.amount, 0) + COALESCE((
      SELECT SUM(v.amount)
      FROM vault_entries v
      WHERE v.entry_type <> 'count'
        AND v.account = acct.account
        AND v.seq > COALESCE(lc.seq, 0)
    ), 0)
  AS DECIMAL(12,2)) AS balance,
  lc.created_at AS last_counted_at
FROM (
  SELECT 'cash' AS account
  UNION ALL SELECT 'gcash'
  UNION ALL SELECT 'maya'
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
