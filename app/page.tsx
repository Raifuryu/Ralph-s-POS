import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_METHODS } from "@/lib/types";
import { signOut } from "./login/actions";
import NewSaleDrawer from "./newSaleDrawer";
import TransactionFilters from "./transactionFilters";
import TransactionTabs from "./transactionTabs";

const TRANSACTION_SELECT = `
  id, payment_method, cashier_id, total, created_at,
  transaction_items (
    id, transaction_id, product_id, product_name, unit_price, quantity, line_total
  )
`;

/** `%` and `_` are wildcards in ilike; a literal search must escape them. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  from_ts?: string;
  to_ts?: string;
};

function LoadError({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center p-4 sm:p-8 md:p-12">
      <div className="w-full max-w-3xl rounded-lg border border-destructive/50 p-4">
        <h1 className="font-semibold">Could not load transactions</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          If this says the table is missing, the schema in{" "}
          <code className="text-xs">supabase/migrations/0001_init.sql</code> has
          not been applied yet.
        </p>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const supabase = await createClient();

  // Item search runs as a separate lookup rather than an inner join on
  // transaction_items. An inner join would filter the *nested rows* too, so a
  // matched sale would render only its matching lines while still showing its
  // full total — the rows wouldn't add up. Instead: find which transactions
  // contain a match, then load those transactions whole.
  let matchedIds: string[] | null = null;
  if (q) {
    const { data: matches, error: matchError } = await supabase
      .from("transaction_items")
      .select("transaction_id")
      .ilike("product_name", `%${escapeLike(q)}%`);

    if (matchError) {
      return <LoadError message={matchError.message} />;
    }
    matchedIds = [...new Set(matches.map((row) => row.transaction_id))];
  }

  let query = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .order("created_at", { ascending: false })
    .limit(100);

  if (params.from_ts) query = query.gte("created_at", params.from_ts);
  if (params.to_ts) query = query.lte("created_at", params.to_ts);
  if (matchedIds) query = query.in("id", matchedIds);

  // `.in("id", [])` is a valid empty-set filter, so no special case is needed
  // for "search matched nothing" — it correctly returns zero rows.
  const [{ data, error }, { data: products }, { data: topSellers }] =
    await Promise.all([
      query,
      supabase
        .from("products")
        .select(
          "id, name, price, stock, description, is_active, created_at, updated_at"
        )
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("product_sales_totals")
        .select("product_id, units_sold")
        .order("units_sold", { ascending: false })
        .limit(5),
    ]);

  if (error) {
    return <LoadError message={error.message} />;
  }

  const transactions = data ?? [];

  const totals = {
    all: transactions.reduce((sum, t) => sum + Number(t.total), 0),
    ...Object.fromEntries(
      PAYMENT_METHODS.map((method) => [
        method,
        transactions
          .filter((t) => t.payment_method === method)
          .reduce((sum, t) => sum + Number(t.total), 0),
      ])
    ),
  } as Record<"all" | (typeof PAYMENT_METHODS)[number], number>;

  const itemsSold = transactions.reduce(
    (sum, t) =>
      sum + t.transaction_items.reduce((n, item) => n + item.quantity, 0),
    0
  );

  return (
    <main className="flex min-h-dvh flex-col items-center p-4 pb-28 sm:p-8 sm:pb-8 md:p-12">
      <div className="flex w-full min-w-0 max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Sales</h1>
          <div className="flex items-center gap-2">
            <NewSaleDrawer
              products={products ?? []}
              topProductIds={(topSellers ?? [])
                .map((row) => row.product_id)
                .filter((id): id is string => id !== null)}
            />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/inventory" />}
            >
              Inventory
            </Button>
            <form action={signOut}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        <TransactionFilters
          initial={{ q, from: params.from ?? "", to: params.to ?? "" }}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Total sales" value={formatPeso(totals.all)} />
          <SummaryCard label="Cash" value={formatPeso(totals.cash)} />
          <SummaryCard label="E-Wallet" value={formatPeso(totals.e_wallet)} />
          <SummaryCard label="Items sold" value={String(itemsSold)} />
        </div>

        <TransactionTabs transactions={transactions} />
      </div>
    </main>
  );
}
