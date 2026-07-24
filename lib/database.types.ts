export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      product_restocks: {
        Row: {
          cashier_id: string
          cost: number
          created_at: string
          id: string
          note: string | null
          product_id: string | null
          product_name: string
          quantity: number
        }
        Insert: {
          cashier_id?: string
          cost: number
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string | null
          product_name: string
          quantity: number
        }
        Update: {
          cashier_id?: string
          cost?: number
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_restocks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          cost: number | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          low_stock_threshold: number | null
          name: string
          price: number
          stock: number | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          cost?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          low_stock_threshold?: number | null
          name: string
          price: number
          stock?: number | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          cost?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          low_stock_threshold?: number | null
          name?: string
          price?: number
          stock?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      service_transactions: {
        Row: {
          cash_flow: Database["public"]["Enums"]["cash_flow"]
          cashier_id: string
          contact_number: string | null
          created_at: string
          description: string | null
          fee: number
          id: string
          payment_account: Database["public"]["Enums"]["money_account"]
          principal: number
          reference: string | null
          service_id: string | null
          service_name: string
          tendered: number | null
          wallet: Database["public"]["Enums"]["money_account"] | null
        }
        Insert: {
          cash_flow: Database["public"]["Enums"]["cash_flow"]
          cashier_id?: string
          contact_number?: string | null
          created_at?: string
          description?: string | null
          fee: number
          id?: string
          payment_account: Database["public"]["Enums"]["money_account"]
          principal: number
          reference?: string | null
          service_id?: string | null
          service_name: string
          tendered?: number | null
          wallet?: Database["public"]["Enums"]["money_account"] | null
        }
        Update: {
          cash_flow?: Database["public"]["Enums"]["cash_flow"]
          cashier_id?: string
          contact_number?: string | null
          created_at?: string
          description?: string | null
          fee?: number
          id?: string
          payment_account?: Database["public"]["Enums"]["money_account"]
          principal?: number
          reference?: string | null
          service_id?: string | null
          service_name?: string
          tendered?: number | null
          wallet?: Database["public"]["Enums"]["money_account"] | null
        }
        Relationships: [
          {
            foreignKeyName: "service_transactions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          allowed_payment_accounts: Database["public"]["Enums"]["money_account"][]
          cash_flow: Database["public"]["Enums"]["cash_flow"]
          created_at: string
          default_fee: number | null
          fee_tiers: Json
          id: string
          is_active: boolean
          name: string
          updated_at: string
          wallet: Database["public"]["Enums"]["money_account"] | null
        }
        Insert: {
          allowed_payment_accounts?: Database["public"]["Enums"]["money_account"][]
          cash_flow?: Database["public"]["Enums"]["cash_flow"]
          created_at?: string
          default_fee?: number | null
          fee_tiers?: Json
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          wallet?: Database["public"]["Enums"]["money_account"] | null
        }
        Update: {
          allowed_payment_accounts?: Database["public"]["Enums"]["money_account"][]
          cash_flow?: Database["public"]["Enums"]["cash_flow"]
          created_at?: string
          default_fee?: number | null
          fee_tiers?: Json
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          wallet?: Database["public"]["Enums"]["money_account"] | null
        }
        Relationships: []
      }
      transaction_items: {
        Row: {
          id: string
          line_total: number
          product_id: string | null
          product_name: string
          quantity: number
          transaction_id: string
          unit_cost: number | null
          unit_price: number
        }
        Insert: {
          id?: string
          line_total?: number
          product_id?: string | null
          product_name: string
          quantity: number
          transaction_id: string
          unit_cost?: number | null
          unit_price: number
        }
        Update: {
          id?: string
          line_total?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          transaction_id?: string
          unit_cost?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "transaction_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          cashier_id: string
          created_at: string
          id: string
          is_personal_take: boolean
          payment_method: Database["public"]["Enums"]["money_account"] | null
          tendered: number | null
          total: number
        }
        Insert: {
          cashier_id?: string
          created_at?: string
          id?: string
          is_personal_take?: boolean
          payment_method?: Database["public"]["Enums"]["money_account"] | null
          tendered?: number | null
          total: number
        }
        Update: {
          cashier_id?: string
          created_at?: string
          id?: string
          is_personal_take?: boolean
          payment_method?: Database["public"]["Enums"]["money_account"] | null
          tendered?: number | null
          total?: number
        }
        Relationships: []
      }
      vault_entries: {
        Row: {
          account: Database["public"]["Enums"]["money_account"]
          amount: number
          created_at: string
          created_by: string
          entry_type: Database["public"]["Enums"]["vault_entry_type"]
          expected: number | null
          id: string
          note: string | null
          seq: number
          service_transaction_id: string | null
          transaction_id: string | null
        }
        Insert: {
          account: Database["public"]["Enums"]["money_account"]
          amount: number
          created_at?: string
          created_by?: string
          entry_type: Database["public"]["Enums"]["vault_entry_type"]
          expected?: number | null
          id?: string
          note?: string | null
          seq?: never
          service_transaction_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          account?: Database["public"]["Enums"]["money_account"]
          amount?: number
          created_at?: string
          created_by?: string
          entry_type?: Database["public"]["Enums"]["vault_entry_type"]
          expected?: number | null
          id?: string
          note?: string | null
          seq?: never
          service_transaction_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_entries_service_transaction_id_fkey"
            columns: ["service_transaction_id"]
            isOneToOne: false
            referencedRelation: "service_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_sales_totals: {
        Row: {
          product_id: string | null
          units_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_balance: {
        Row: {
          account: Database["public"]["Enums"]["money_account"] | null
          balance: number | null
          last_counted_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      checkout: {
        Args: {
          p_items: Json
          p_payment_method?: Database["public"]["Enums"]["money_account"]
          p_personal_take?: boolean
          p_tendered?: number
        }
        Returns: string
      }
      record_bulk_restock: { Args: { p_items: Json }; Returns: Json }
      record_restock: {
        Args: {
          p_cost: number
          p_note?: string
          p_product_id: string
          p_quantity: number
        }
        Returns: string
      }
      record_service: {
        Args: {
          p_contact_number?: string
          p_description?: string
          p_fee: number
          p_fee_in_wallet?: boolean
          p_payment_account?: Database["public"]["Enums"]["money_account"]
          p_principal: number
          p_reference?: string
          p_service_id: string
          p_tendered?: number
        }
        Returns: string
      }
      record_vault_count: {
        Args: {
          p_account: Database["public"]["Enums"]["money_account"]
          p_counted: number
        }
        Returns: Json
      }
    }
    Enums: {
      cash_flow: "in" | "out"
      money_account: "cash" | "gcash" | "maya"
      vault_entry_type: "sale" | "service" | "deposit" | "withdrawal" | "count"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals["public"]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cash_flow: ["in", "out"],
      money_account: ["cash", "gcash", "maya"],
      vault_entry_type: ["sale", "service", "deposit", "withdrawal", "count"],
    },
  },
} as const
