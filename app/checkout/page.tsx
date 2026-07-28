import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import type { MoneyAccount } from "@/lib/types";
import CheckoutForm from "./checkoutForm";

export default async function CheckoutPage() {
  const supabase = await createClient();

  const [
    { data: products, error },
    { data: services, error: servicesError },
    { data: vaultRows, error: vaultError },
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, price, cost, stock, description, category_id, low_stock_threshold, expiry_date, is_active, created_at, updated_at"
      )
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("services")
      .select(
        "id, name, cash_flow, default_fee, fee_tiers, wallet, allowed_payment_accounts, pricing_mode, unit_prices, is_active, created_at, updated_at"
      )
      .eq("is_active", true)
      .order("name"),
    supabase.from("vault_balance").select("account, balance"),
  ]);

  if (error) {
    return (
      <PageError title="Could not load products" message={error.message} />
    );
  }
  if (servicesError) {
    return (
      <PageError title="Could not load services" message={servicesError.message} />
    );
  }
  if (vaultError) {
    return (
      <PageError title="Could not load the vault" message={vaultError.message} />
    );
  }

  const balances = new Map<MoneyAccount, number>();
  for (const row of vaultRows ?? []) {
    if (row.account) balances.set(row.account, Number(row.balance ?? 0));
  }

  return (
    <PageShell innerClassName="max-w-2xl">
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">New sale</h1>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Cancel
          </Button>
        </div>

        <CheckoutForm
          products={products ?? []}
          services={services ?? []}
          balances={balances}
        />
      </>
    </PageShell>
  );
}
