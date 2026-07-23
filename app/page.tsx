import { Pager } from "@/components/pager";
import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import { storeDayKey, storeDayRange } from "@/lib/format";
import { pageCountFor, pageRange, parsePage } from "@/lib/pagination";
import { escapeLike } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import type { MoneyAccount, SalesEntry } from "@/lib/types";
import { signOut } from "./login/actions";
import IncomeBreakdownCard, { type EServiceFees } from "./incomeBreakdownCard";
import NewSaleDrawer from "./newSaleDrawer";
import ServiceDrawer from "./serviceDrawer";
import VaultCard from "./vaultCard";
import TransactionFilters from "./transactionFilters";
import TransactionTabs from "./transactionTabs";

/**
 * The dashboard is a daily view, always — a separate summary page will
 * eventually cover ranges/all-time, so the title here never has to say
 * anything other than "today."
 */
function incomeCardCopy({ q }: { q?: string }): {
  title: string;
  subtitle?: string;
} {
  return {
    title: "Today's income",
    subtitle: q ? `matching "${q}"` : undefined,
  };
}

const TRANSACTION_SELECT = `
  id, payment_method, cashier_id, total, tendered, created_at, is_personal_take,
  transaction_items (
    id, transaction_id, product_id, product_name, unit_price, quantity, line_total
  )
`;

/** Newest-first merge of both money-in event kinds into one feed. */
function sortByCreatedAtDesc(entries: SalesEntry[]): SalesEntry[] {
  return [...entries].sort(
    (a, b) =>
      new Date(b.data.created_at).getTime() -
      new Date(a.data.created_at).getTime()
  );
}

type SearchParams = {
  q?: string;
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

  // Item/service search runs as separate lookups rather than inner joins on
  // the nested rows. An inner join on transaction_items would filter those
  // *nested* rows too, so a matched sale would render only its matching
  // lines while still showing its full total — the rows wouldn't add up.
  // Both run in parallel — neither depends on the other.
  let matchedIds: string[] | null = null;
  let matchedServiceIds: string[] | null = null;
  if (q) {
    const [
      { data: itemMatches, error: itemMatchError },
      { data: serviceMatches, error: serviceMatchError },
    ] = await Promise.all([
      supabase
        .from("transaction_items")
        .select("transaction_id")
        .ilike("product_name", `%${escapeLike(q)}%`),
      supabase
        .from("service_transactions")
        .select("id")
        .or(
          `service_name.ilike.%${escapeLike(q)}%,reference.ilike.%${escapeLike(q)}%`
        ),
    ]);

    if (itemMatchError) {
      return <LoadError message={itemMatchError.message} />;
    }
    if (serviceMatchError) {
      return <LoadError message={serviceMatchError.message} />;
    }
    matchedIds = [...new Set(itemMatches.map((row) => row.transaction_id))];
    matchedServiceIds = serviceMatches.map((row) => row.id);
  }

  const page = parsePage(params.page);
  const { rangeFrom, rangeTo } = pageRange(page);

  // The dashboard is a daily view, always — a separate summary page will
  // eventually cover ranges/all-time (not built yet), so every query below
  // is unconditionally pinned to the store's "today," not a user-picked
  // window.
  const { fromTs, toTs } = storeDayRange(storeDayKey(new Date()));

  // Sales list: every matching transaction today, unpaginated — pagination
  // happens in JS below, after merging with service_transactions into one
  // chronological feed. This also doubles as the source for storeTotal/
  // itemsSold, replacing what used to be a second "totals" query.
  let salesQuery = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .gte("created_at", fromTs)
    .lte("created_at", toTs)
    .order("created_at", { ascending: false });

  if (matchedIds) salesQuery = salesQuery.in("id", matchedIds);

  // Same idea, the e-service side of the merged feed.
  let serviceListQuery = supabase
    .from("service_transactions")
    .select("*")
    .gte("created_at", fromTs)
    .lte("created_at", toTs)
    .order("created_at", { ascending: false });

  if (matchedServiceIds) serviceListQuery = serviceListQuery.in("id", matchedServiceIds);

  // `.in("id", [])` is a valid empty-set filter, so no special case is needed
  // for "search matched nothing" — it correctly returns zero rows.
  // E-Service income respects the same date window as the sales list, but
  // deliberately NOT the search filter above — it's a summary total for the
  // whole day, same as it's always been, not a filtered-view figure.
  // PostgREST aggregates are disabled, so fees are fetched and grouped by
  // wallet here rather than in SQL.
  const feeQuery = supabase
    .from("service_transactions")
    .select("fee, wallet")
    .gte("created_at", fromTs)
    .lte("created_at", toTs);

  const [
    { data: salesData, error: salesError },
    { data: serviceListData, error: serviceListError },
    { data: products },
    { data: topSellers },
    { data: services },
    { data: serviceFees },
    { data: vaultRows, error: vaultError },
  ] = await Promise.all([
    salesQuery,
    serviceListQuery,
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
      .select("id, name, cash_flow, default_fee, fee_tiers, wallet, allowed_payment_accounts, is_active, created_at, updated_at")
      .eq("is_active", true)
      .order("name"),
    feeQuery,
    supabase.from("vault_balance").select("account, balance"),
  ]);

  if (salesError) {
    return <LoadError message={salesError.message} />;
  }
  if (serviceListError) {
    return <LoadError message={serviceListError.message} />;
  }
  if (vaultError) {
    return <LoadError message={vaultError.message} />;
  }

  const sales = salesData ?? [];
  const serviceList = serviceListData ?? [];

  // One chronological feed, newest first, then paginated in JS — the two
  // source tables can't share a single DB-level .range() the way one table
  // could, so both are fetched in full for the window and sliced here.
  const merged = sortByCreatedAtDesc([
    ...sales.map((t) => ({ kind: "sale" as const, data: t })),
    ...serviceList.map((s) => ({ kind: "service" as const, data: s })),
  ]);
  const pageCount = pageCountFor(merged.length);
  const pageEntries = merged.slice(rangeFrom, rangeTo + 1);

  // Store = all product sales in the window, regardless of payment method —
  // a sale is store revenue whether the customer paid cash, GCash, or Maya.
  // Personal takes deduct stock but aren't income, so they're excluded here
  // (and from itemsSold below) the same way they're excluded everywhere else.
  const storeTotal = sales.reduce(
    (sum, t) => sum + (t.is_personal_take ? 0 : Number(t.total)),
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
    q,
  });

  // Live money on hand, straight from the vault ledger (all-time balances —
  // the date filters deliberately do not apply to a balance).
  const vault = new Map<MoneyAccount, number>();
  for (const row of vaultRows ?? []) {
    if (row.account) vault.set(row.account, Number(row.balance ?? 0));
  }

  // Same reasoning as storeTotal: counted over the whole filtered window via
  // `sales`, not just the visible page.
  const itemsSold = sales.reduce(
    (sum, t) =>
      sum +
      (t.is_personal_take
        ? 0
        : t.transaction_items.reduce((n, item) => n + item.quantity, 0)),
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
          initial={{ q, from: "", to: "" }}
          showDateRange={false}
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

        <TransactionTabs entries={pageEntries} />

        <Pager
          page={page}
          pageCount={pageCount}
          basePath="/"
          params={{ q: params.q }}
        />
      </>
    </PageShell>
  );
}
