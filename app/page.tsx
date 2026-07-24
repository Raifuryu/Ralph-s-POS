import { Pager } from "@/components/pager";
import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { Button } from "@/components/ui/button";
import {
  formatPeso,
  friendlyDayLabel,
  storeDateFromKey,
  storeDayKey,
  storeDayRange,
} from "@/lib/format";
import { pageCountFor, pageRange, parsePage } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { SALES_FILTERS, type MoneyAccount, type SalesEntry } from "@/lib/types";
import { signOut } from "./login/actions";
import DashboardDateFilter from "./dashboardDateFilter";
import IncomeBreakdownCard, { type EServiceFees } from "./incomeBreakdownCard";
import NewSaleDrawer from "./newSaleDrawer";
import ServiceDrawer from "./serviceDrawer";
import VaultCard from "./vaultCard";
import TransactionTabs from "./transactionTabs";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Today's income" / "Yesterday's income" read naturally in the title; any
 * other picked day would not ("Jul 20, 2026's income"), so those fall back
 * to a plain title with the date in the subtitle instead.
 */
function incomeCardCopy({
  dateKey,
  unknownCostNote,
}: {
  dateKey: string;
  /** Set when some of the day's store revenue has no recorded cost yet, so
      Store profit below understates real profit rather than overstating it. */
  unknownCostNote?: string;
}): {
  title: string;
  subtitle?: string;
} {
  const label = friendlyDayLabel(storeDateFromKey(dateKey));
  const isRelative = label === "Today" || label === "Yesterday";
  const parts = [isRelative ? null : label, unknownCostNote ?? null].filter(
    (part): part is string => part !== null
  );
  return {
    title: isRelative ? `${label}'s income` : "Income",
    subtitle: parts.length > 0 ? parts.join(" · ") : undefined,
  };
}

const TRANSACTION_SELECT = `
  id, payment_method, cashier_id, total, tendered, created_at, is_personal_take,
  transaction_items (
    id, transaction_id, product_id, product_name, unit_price, unit_cost, quantity, line_total
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
  date?: string;
  page?: string;
  tab?: string;
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
  const supabase = await createClient();

  // The dashboard is a day-at-a-time view — one calendar day, picked via
  // DashboardDateFilter, defaulting to today. Ranges/all-time live on
  // Statistics instead. Garbage/malformed input (a hand-edited URL, a stale
  // bookmark from before the date param existed) falls back to today rather
  // than erroring.
  const today = storeDayKey(new Date());
  const dateKey =
    params.date && DATE_KEY_PATTERN.test(params.date) ? params.date : today;

  const page = parsePage(params.page);
  const { rangeFrom, rangeTo } = pageRange(page);
  const activeTab = SALES_FILTERS.includes(params.tab as (typeof SALES_FILTERS)[number])
    ? (params.tab as (typeof SALES_FILTERS)[number])
    : "all";

  const { fromTs, toTs } = storeDayRange(dateKey);

  // Sales list: every transaction on the picked day, unpaginated —
  // pagination happens in JS below, after merging with service_transactions
  // into one chronological feed. This also doubles as the source for
  // storeMargin/itemsSold, replacing what used to be a second "totals" query.
  const salesQuery = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .gte("created_at", fromTs)
    .lte("created_at", toTs)
    .order("created_at", { ascending: false });

  // Same idea, the e-service side of the merged feed.
  const serviceListQuery = supabase
    .from("service_transactions")
    .select("*")
    .gte("created_at", fromTs)
    .lte("created_at", toTs)
    .order("created_at", { ascending: false });

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
        "id, name, price, cost, stock, description, category_id, low_stock_threshold, is_active, created_at, updated_at"
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

  // Store = real profit (price - cost) on the picked day's product sales,
  // not gross revenue — matching how E-Service below already only counts
  // the fee, not the pass-through principal. A line only has a known margin
  // once its product has been restocked through the app at least once
  // (unit_cost is snapshotted from products.cost at sale time — see
  // migration 0021); older/never-restocked lines have no cost recorded, so
  // they're tracked separately and excluded rather than assumed to be 100%
  // margin. Personal takes deduct stock but aren't income, so they're
  // excluded here (and from itemsSold below) the same way they're excluded
  // everywhere else.
  let storeMargin = 0;
  let storeRevenueWithUnknownCost = 0;
  for (const t of sales) {
    if (t.is_personal_take) continue;
    for (const item of t.transaction_items) {
      const lineRevenue = Number(item.line_total);
      if (item.unit_cost !== null) {
        storeMargin += lineRevenue - Number(item.unit_cost) * item.quantity;
      } else {
        storeRevenueWithUnknownCost += lineRevenue;
      }
    }
  }

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
    dateKey,
    unknownCostNote:
      storeRevenueWithUnknownCost > 0
        ? `${formatPeso(storeRevenueWithUnknownCost)} in sales has no recorded cost yet`
        : undefined,
  });

  // Live money on hand, straight from the vault ledger (all-time balances —
  // the date filters deliberately do not apply to a balance).
  const vault = new Map<MoneyAccount, number>();
  for (const row of vaultRows ?? []) {
    if (row.account) vault.set(row.account, Number(row.balance ?? 0));
  }

  // Same reasoning as storeMargin: counted over the whole filtered window via
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

        <DashboardDateFilter dateKey={dateKey} />

        {/* Vault (money on hand) and Income (this window, by source) are the
            two headline cards — equal weight, stacked on mobile, side by
            side from sm up. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VaultCard balances={vault} />
          <IncomeBreakdownCard
            title={incomeTitle}
            subtitle={incomeSubtitle}
            store={storeMargin}
            storeLabel="Store profit"
            eService={eServiceFees}
          />
        </div>

        <TransactionTabs entries={pageEntries} activeTab={activeTab} />

        <Pager
          page={page}
          pageCount={pageCount}
          basePath="/"
          params={{
            date: dateKey === today ? undefined : dateKey,
            tab: activeTab === "all" ? undefined : activeTab,
          }}
        />
      </>
    </PageShell>
  );
}
