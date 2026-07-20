import Link from "next/link";

import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_METHODS } from "@/lib/types";
import { signOut } from "./login/actions";
import NewSaleDrawer from "./newSaleDrawer";
import ServiceDrawer from "./serviceDrawer";
import TransactionFilters from "./transactionFilters";
import TransactionTabs from "./transactionTabs";

const TRANSACTION_SELECT = `
  id, payment_method, cashier_id, total, tendered, created_at,
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
    <PageError
      title="Could not load transactions"
      message={message}
      hint={
        <>
          If this says a table is missing, a migration in{" "}
          <code className="text-xs">supabase/migrations/</code> has not been
          applied yet.
        </>
      }
    />
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
  // Service income respects the same date window as the sales list. PostgREST
  // aggregates are disabled, so fees are fetched and summed here.
  let feeQuery = supabase.from("service_transactions").select("fee");
  if (params.from_ts) feeQuery = feeQuery.gte("created_at", params.from_ts);
  if (params.to_ts) feeQuery = feeQuery.lte("created_at", params.to_ts);

  const [
    { data, error },
    { data: products },
    { data: topSellers },
    { data: services },
    { data: serviceFees },
  ] = await Promise.all([
    query,
    supabase
      .from("products")
      .select(
        "id, name, price, stock, description, category_id, is_active, created_at, updated_at"
      )
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("product_sales_totals")
      .select("product_id, units_sold")
      .order("units_sold", { ascending: false })
      .limit(5),
    supabase
      .from("services")
      .select("id, name, cash_flow, default_fee, wallet, is_active, created_at, updated_at")
      .eq("is_active", true)
      .order("name"),
    feeQuery,
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

  const serviceIncome = (serviceFees ?? []).reduce(
    (sum, row) => sum + Number(row.fee),
    0
  );

  return (
    <PageShell className="pb-28 sm:pb-8">
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Sales</h1>
          <div className="flex flex-wrap items-center gap-2">
            <NewSaleDrawer
              products={products ?? []}
              topProductIds={(topSellers ?? [])
                .map((row) => row.product_id)
                .filter((id): id is string => id !== null)}
            />
            <ServiceDrawer services={services ?? []} />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/vault" />}
            >
              Vault
            </Button>
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
          <SummaryCard
            label="Cash"
            value={formatPeso(totals.cash)}
            breakdown={[
              { label: "GCash", value: formatPeso(totals.gcash) },
              { label: "Maya", value: formatPeso(totals.maya) },
            ]}
          />
          <SummaryCard
            label="Service income"
            value={formatPeso(serviceIncome)}
          />
          <SummaryCard label="Items sold" value={String(itemsSold)} />
        </div>

        <TransactionTabs transactions={transactions} />
      </>
    </PageShell>
  );
}
