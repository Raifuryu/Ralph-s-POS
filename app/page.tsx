import { Pager } from "@/components/pager";
import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import { formatDate, friendlyDayLabel, storeDateFromKey } from "@/lib/format";
import { pageCountFor, pageRange, parsePage } from "@/lib/pagination";
import { escapeLike } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import type { MoneyAccount } from "@/lib/types";
import { signOut } from "./login/actions";
import IncomeBreakdownCard, { type EServiceFees } from "./incomeBreakdownCard";
import NewSaleDrawer from "./newSaleDrawer";
import ServiceDrawer from "./serviceDrawer";
import VaultCard from "./vaultCard";
import TransactionFilters from "./transactionFilters";
import TransactionTabs from "./transactionTabs";

/**
 * Names the number on the income card after whatever window is active, so
 * it's never ambiguous whether you're looking at today, a range, or
 * everything — "the daily transaction only or depending on the filter."
 */
function incomeCardCopy({
  from,
  to,
  q,
}: {
  from?: string;
  to?: string;
  q?: string;
}): { title: string; subtitle?: string } {
  const parts: string[] = [];
  let title = "Total income";

  if (from && to && from === to) {
    const label = friendlyDayLabel(storeDateFromKey(from));
    if (label === "Today") {
      title = "Today's income";
    } else {
      title = "Income";
      parts.push(label);
    }
  } else if (from || to) {
    title = "Income";
    if (from && to) {
      parts.push(
        `${formatDate(storeDateFromKey(from))} – ${formatDate(storeDateFromKey(to))}`
      );
    } else if (from) {
      parts.push(`Since ${formatDate(storeDateFromKey(from))}`);
    } else if (to) {
      parts.push(`Until ${formatDate(storeDateFromKey(to))}`);
    }
  } else {
    parts.push("All time");
  }

  if (q) parts.push(`matching "${q}"`);

  return { title, subtitle: parts.length ? parts.join(" · ") : undefined };
}

const TRANSACTION_SELECT = `
  id, payment_method, cashier_id, total, tendered, created_at, is_personal_take,
  transaction_items (
    id, transaction_id, product_id, product_name, unit_price, quantity, line_total
  )
`;

type SearchParams = {
  q?: string;
  from?: string;
  to?: string;
  from_ts?: string;
  to_ts?: string;
  page?: string;
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

  const page = parsePage(params.page);
  const { rangeFrom, rangeTo } = pageRange(page);

  // Render query: paginated, drives the visible list only. `count: "exact"`
  // gets the true row total for the pager without a second round trip.
  let query = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (params.from_ts) query = query.gte("created_at", params.from_ts);
  if (params.to_ts) query = query.lte("created_at", params.to_ts);
  if (matchedIds) query = query.in("id", matchedIds);

  // Totals query: the SAME filters, but every matching row and no pagination
  // — the income card sums the whole filtered window, not just the page
  // someone happens to be looking at. Lean select (no item name/price):
  // this is for sums only, never rendered.
  // Personal takes deduct stock but aren't income — excluded here so
  // storeTotal/itemsSold below only ever reflect what was actually sold.
  let totalsQuery = supabase
    .from("transactions")
    .select("total, payment_method, transaction_items(quantity)")
    .eq("is_personal_take", false);

  if (params.from_ts) totalsQuery = totalsQuery.gte("created_at", params.from_ts);
  if (params.to_ts) totalsQuery = totalsQuery.lte("created_at", params.to_ts);
  if (matchedIds) totalsQuery = totalsQuery.in("id", matchedIds);

  // `.in("id", [])` is a valid empty-set filter, so no special case is needed
  // for "search matched nothing" — it correctly returns zero rows.
  // E-Service income respects the same date window as the sales list.
  // PostgREST aggregates are disabled, so fees are fetched and grouped by
  // wallet here rather than in SQL.
  let feeQuery = supabase.from("service_transactions").select("fee, wallet");
  if (params.from_ts) feeQuery = feeQuery.gte("created_at", params.from_ts);
  if (params.to_ts) feeQuery = feeQuery.lte("created_at", params.to_ts);

  const [
    { data, error, count },
    { data: totalsData, error: totalsError },
    { data: products },
    { data: topSellers },
    { data: services },
    { data: serviceFees },
    { data: vaultRows, error: vaultError },
  ] = await Promise.all([
    query,
    totalsQuery,
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
      .select("id, name, cash_flow, default_fee, wallet, allowed_payment_accounts, is_active, created_at, updated_at")
      .eq("is_active", true)
      .order("name"),
    feeQuery,
    supabase.from("vault_balance").select("account, balance"),
  ]);

  if (error) {
    return <LoadError message={error.message} />;
  }
  if (totalsError) {
    return <LoadError message={totalsError.message} />;
  }
  if (vaultError) {
    return <LoadError message={vaultError.message} />;
  }

  const transactions = data ?? [];
  const pageCount = pageCountFor(count);

  // Store = all product sales in the window, regardless of payment method —
  // a sale is store revenue whether the customer paid cash, GCash, or Maya.
  const storeTotal = (totalsData ?? []).reduce(
    (sum, t) => sum + Number(t.total),
    0
  );

  // E-Service = service fee income, further split by which wallet the
  // service touches. "Other" catches wallet-less services (e.g. printing)
  // paid in cash — still fee income, just not tied to a specific e-wallet.
  const eServiceFees: EServiceFees = { gcash: 0, maya: 0, other: 0 };
  for (const row of serviceFees ?? []) {
    const fee = Number(row.fee);
    if (row.wallet === "gcash") eServiceFees.gcash += fee;
    else if (row.wallet === "maya") eServiceFees.maya += fee;
    else eServiceFees.other += fee;
  }

  const { title: incomeTitle, subtitle: incomeSubtitle } = incomeCardCopy({
    from: params.from,
    to: params.to,
    q,
  });

  // Live money on hand, straight from the vault ledger (all-time balances —
  // the date filters deliberately do not apply to a balance).
  const vault = new Map<MoneyAccount, number>();
  for (const row of vaultRows ?? []) {
    if (row.account) vault.set(row.account, Number(row.balance ?? 0));
  }

  // Same reasoning as storeTotal: counted over the whole filtered window via
  // totalsData, not just the visible page.
  const itemsSold = (totalsData ?? []).reduce(
    (sum, t) =>
      sum + t.transaction_items.reduce((n, item) => n + item.quantity, 0),
    0
  );

  return (
    <PageShell className="pb-32 sm:pb-8">
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
            <ServiceDrawer services={services ?? []} balances={vault} />
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

        {/* Vault (money on hand) and Income (this window, by source) are the
            two headline cards — equal weight, stacked on mobile, side by
            side from sm up. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VaultCard balances={vault} />
          <IncomeBreakdownCard
            title={incomeTitle}
            subtitle={incomeSubtitle}
            store={storeTotal}
            eService={eServiceFees}
          />
        </div>

        <SummaryCard
          label="Items sold"
          value={String(itemsSold)}
          compact
          className="sm:w-fit sm:min-w-40"
        />

        <TransactionTabs transactions={transactions} />

        <Pager
          page={page}
          pageCount={pageCount}
          basePath="/"
          params={{
            q: params.q,
            from: params.from,
            to: params.to,
            from_ts: params.from_ts,
            to_ts: params.to_ts,
          }}
        />
      </>
    </PageShell>
  );
}
