/**
 * Hand-written replacement for the old Supabase-generated `database.types.ts`
 * — there's no type generator for a plain MariaDB connection, so this is
 * kept in sync with `mariadb/schema.sql` by hand. Only the pieces `lib/types.ts`
 * actually consumes are reproduced: `Tables<"x">` row shapes, `Json`, and the
 * `Constants.public.Enums.*` tuples the app reads its enum value lists from.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type CashFlow = "in" | "out";
export type MoneyAccountEnum = "cash" | "gcash" | "maya";
export type ServicePricingModeEnum = "flat" | "per_unit";
export type VaultEntryTypeEnum =
  | "sale"
  | "service"
  | "deposit"
  | "withdrawal"
  | "count"
  | "void"
  | "adjustment";

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          created_at: string;
        };
      };
      categories: {
        Row: {
          id: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
      };
      products: {
        Row: {
          id: string;
          name: string;
          price: number;
          stock: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          description: string | null;
          category_id: string | null;
          low_stock_threshold: number | null;
          cost: number | null;
          expiry_date: string | null;
        };
      };
      product_restocks: {
        Row: {
          id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          cost: number;
          note: string | null;
          cashier_id: string;
          created_at: string;
        };
      };
      services: {
        Row: {
          id: string;
          name: string;
          cash_flow: CashFlow;
          default_fee: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          wallet: MoneyAccountEnum | null;
          allowed_payment_accounts: MoneyAccountEnum[];
          fee_tiers: Json;
          pricing_mode: ServicePricingModeEnum;
          unit_prices: Json | null;
        };
      };
      transactions: {
        Row: {
          id: string;
          payment_method: MoneyAccountEnum | null;
          cashier_id: string;
          total: number;
          created_at: string;
          tendered: number | null;
          is_personal_take: boolean;
          voided_at: string | null;
          voided_by: string | null;
          void_reason: string | null;
          visit_id: string | null;
          debtor_name: string | null;
          debtor_description: string | null;
          settled_at: string | null;
          settled_by: string | null;
        };
      };
      transaction_items: {
        Row: {
          id: string;
          transaction_id: string;
          product_id: string | null;
          product_name: string;
          unit_price: number;
          quantity: number;
          unit_cost: number | null;
          discount_amount: number;
          surcharge_amount: number;
          line_total: number | null;
        };
      };
      service_transactions: {
        Row: {
          id: string;
          service_id: string | null;
          service_name: string;
          cash_flow: CashFlow;
          principal: number;
          fee: number;
          cashier_id: string;
          created_at: string;
          wallet: MoneyAccountEnum | null;
          payment_account: MoneyAccountEnum;
          contact_number: string | null;
          reference: string | null;
          description: string | null;
          tendered: number | null;
          voided_at: string | null;
          voided_by: string | null;
          void_reason: string | null;
          unit_label: string | null;
          unit_quantity: number | null;
          unit_price: number | null;
          visit_id: string | null;
          discount_amount: number;
          surcharge_amount: number;
        };
      };
      vault_entries: {
        Row: {
          id: string;
          seq: number;
          entry_type: VaultEntryTypeEnum;
          amount: number;
          expected: number | null;
          transaction_id: string | null;
          service_transaction_id: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
          account: MoneyAccountEnum;
        };
      };
      vault_snapshots: {
        Row: {
          id: string;
          snapshot_day: string;
          cash_amount: number;
          gcash_amount: number;
          maya_amount: number;
          total_money: number;
          profit: number;
          income: number | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
      };
    };
    Views: {
      product_sales_totals: {
        Row: { product_id: string; units_sold: number };
      };
      vault_balance: {
        Row: {
          account: MoneyAccountEnum;
          balance: number;
          last_counted_at: string | null;
        };
      };
    };
    Enums: {
      cash_flow: CashFlow;
      money_account: MoneyAccountEnum;
      service_pricing_mode: ServicePricingModeEnum;
      vault_entry_type: VaultEntryTypeEnum;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<
  T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"],
> = T extends keyof PublicSchema["Tables"]
  ? PublicSchema["Tables"][T]["Row"]
  : T extends keyof PublicSchema["Views"]
    ? PublicSchema["Views"][T]["Row"]
    : never;

/** Mirrors the shape the generated Supabase file exported, so `lib/types.ts`
    only needed to change its import line, not its call sites. */
export const Constants = {
  public: {
    Enums: {
      cash_flow: ["in", "out"] as const,
      money_account: ["cash", "gcash", "maya"] as const,
      service_pricing_mode: ["flat", "per_unit"] as const,
      vault_entry_type: [
        "sale",
        "service",
        "deposit",
        "withdrawal",
        "count",
        "void",
        "adjustment",
      ] as const,
    },
  },
} as const;
