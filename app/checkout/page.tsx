import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { Button } from "@/components/ui/button";
import { queryRows } from "@/lib/mysql/pool";
import type { MoneyAccount, Product, Service } from "@/lib/types";
import CheckoutForm from "./checkoutForm";

const PRODUCT_COLUMNS =
  "id, name, price, cost, stock, description, category_id, low_stock_threshold, expiry_date, is_active, created_at, updated_at";
const SERVICE_COLUMNS =
  "id, name, cash_flow, default_fee, fee_tiers, wallet, allowed_payment_accounts, pricing_mode, unit_prices, is_active, created_at, updated_at";

type VaultBalanceRow = { account: MoneyAccount; balance: number };

// Under Supabase, reading the session cookie inside createClient() was
// enough to make Next treat this route as dynamic automatically. Nothing
// here touches cookies()/headers()/searchParams anymore, so without this
// it would get statically optimized at build time — baking in whatever
// inventory/vault snapshot (or DB-unreachable error page) existed the
// moment `next build` ran, served identically to every request after.
export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  let products: Product[];
  let services: Service[];
  let vaultRows: VaultBalanceRow[];

  try {
    [products, services, vaultRows] = await Promise.all([
      queryRows<Product>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE is_active = 1 ORDER BY name`
      ),
      queryRows<Service>(
        `SELECT ${SERVICE_COLUMNS} FROM services WHERE is_active = 1 ORDER BY name`
      ),
      queryRows<VaultBalanceRow>("SELECT account, balance FROM vault_balance"),
    ]);
  } catch (err) {
    return (
      <PageError
        title="Could not load checkout data"
        message={(err as Error).message}
      />
    );
  }

  const balances = new Map<MoneyAccount, number>();
  for (const row of vaultRows) {
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
          products={products}
          services={services}
          balances={balances}
        />
      </>
    </PageShell>
  );
}
