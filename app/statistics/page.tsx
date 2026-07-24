import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { ACCOUNT_ORDER } from "@/lib/accountColors";
import {
  formatDate,
  formatPeso,
  formatShortDate,
  friendlyDayLabel,
  storeDateFromKey,
  storeDayKey,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  MONEY_ACCOUNT_LABELS,
  type MoneyAccount,
  type TransactionWithItems,
} from "@/lib/types";
import IncomeBreakdownCard, { type EServiceFees } from "@/app/incomeBreakdownCard";
import TransactionFilters from "@/app/transactionFilters";
import CategoryLeaderboard, { type CategoryRevenue } from "./categoryLeaderboard";
import PaymentBreakdownCard from "./paymentBreakdownCard";
import RevenueTrendChart, { type RevenueBucket } from "./revenueTrendChart";
import TopProductsTable, { type TopProduct } from "./topProductsTable";

const STATS_TRANSACTION_SELECT = `
  id, payment_method, cashier_id, total, tendered, created_at, is_personal_take,
  transaction_items (
    id, transaction_id, product_id, product_name, unit_price, unit_cost, quantity, line_total
  )
`;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Caps the trend chart at roughly this many bars — beyond it, buckets widen
    (group every N days) rather than rendering an unreadable wall of bars. */
const MAX_BARS = 40;

type SearchParams = {
  from?: string;
  to?: string;
  from_ts?: string;
  to_ts?: string;
};

/** Only the columns this page's service_transactions query actually
    selects — narrower than the full ServiceTransaction row type. */
type ServiceRevenuePoint = {
  fee: number;
  wallet: MoneyAccount | null;
  payment_account: MoneyAccount;
  created_at: string;
};

function LoadError({ message }: { message: string }) {
  return (
    <PageError
      title="Could not load statistics"
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

/** Same "what window is this" phrasing the dashboard used before it was
    locked to daily-only — Statistics is the page that still needs it. */
function rangeSubtitle(from?: string, to?: string): string {
  if (from && to) {
    if (from === to) return friendlyDayLabel(storeDateFromKey(from));
    return `${formatDate(storeDateFromKey(from))} – ${formatDate(storeDateFromKey(to))}`;
  }
  if (from) return `Since ${formatDate(storeDateFromKey(from))}`;
  if (to) return `Until ${formatDate(storeDateFromKey(to))}`;
  return "All time";
}

/** Buckets sale + service revenue by store-day into a chart-ready series.
    Bounds come from the requested from_ts/to_ts when both are set, else from
    the data's own earliest/latest timestamp (so "all time" on a young store
    doesn't try to render decades of empty bars). Widens buckets past
    MAX_BARS so long ranges stay readable. */
function buildRevenueBuckets(
  sales: TransactionWithItems[],
  services: ServiceRevenuePoint[],
  fromTs: string | undefined,
  toTs: string | undefined
): RevenueBucket[] {
  const points = [
    ...sales
      .filter((t) => !t.is_personal_take)
      .map((t) => ({
        ts: new Date(t.created_at).getTime(),
        store: Number(t.total),
        eService: 0,
      })),
    ...services.map((s) => ({
      ts: new Date(s.created_at).getTime(),
      store: 0,
      eService: Number(s.fee),
    })),
  ];

  let startDate: Date;
  let endDate: Date;
  if (fromTs && toTs) {
    startDate = storeDateFromKey(storeDayKey(fromTs));
    endDate = storeDateFromKey(storeDayKey(toTs));
  } else if (points.length > 0) {
    const tsValues = points.map((p) => p.ts);
    startDate = storeDateFromKey(storeDayKey(new Date(Math.min(...tsValues))));
    endDate = storeDateFromKey(storeDayKey(new Date(Math.max(...tsValues))));
  } else {
    return [];
  }

  const totalDays =
    Math.round((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
  const bucketDays = Math.max(1, Math.ceil(totalDays / MAX_BARS));
  const bucketCount = Math.max(1, Math.ceil(totalDays / bucketDays));

  const buckets: RevenueBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = new Date(startDate.getTime() + i * bucketDays * ONE_DAY_MS);
    const bucketEnd = new Date(
      bucketStart.getTime() + (bucketDays - 1) * ONE_DAY_MS
    );
    const label =
      bucketDays === 1
        ? formatShortDate(bucketStart)
        : `${formatShortDate(bucketStart)}–${formatShortDate(bucketEnd)}`;
    return { key: String(i), label, store: 0, eService: 0 };
  });

  for (const point of points) {
    const dayDate = storeDateFromKey(storeDayKey(new Date(point.ts)));
    const dayIndex = Math.round(
      (dayDate.getTime() - startDate.getTime()) / ONE_DAY_MS
    );
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(dayIndex / bucketDays))
    );
    buckets[bucketIndex].store += point.store;
    buckets[bucketIndex].eService += point.eService;
  }

  return buckets;
}

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let salesQuery = supabase
    .from("transactions")
    .select(STATS_TRANSACTION_SELECT)
    .order("created_at", { ascending: true });
  if (params.from_ts) salesQuery = salesQuery.gte("created_at", params.from_ts);
  if (params.to_ts) salesQuery = salesQuery.lte("created_at", params.to_ts);

  let serviceQuery = supabase
    .from("service_transactions")
    .select("fee, wallet, payment_account, created_at")
    .order("created_at", { ascending: true });
  if (params.from_ts) serviceQuery = serviceQuery.gte("created_at", params.from_ts);
  if (params.to_ts) serviceQuery = serviceQuery.lte("created_at", params.to_ts);

  let restockQuery = supabase.from("product_restocks").select("cost, quantity, created_at");
  if (params.from_ts) restockQuery = restockQuery.gte("created_at", params.from_ts);
  if (params.to_ts) restockQuery = restockQuery.lte("created_at", params.to_ts);

  let vaultMovementQuery = supabase
    .from("vault_entries")
    .select("amount, account, entry_type, created_at")
    .in("entry_type", ["deposit", "withdrawal"]);
  if (params.from_ts) vaultMovementQuery = vaultMovementQuery.gte("created_at", params.from_ts);
  if (params.to_ts) vaultMovementQuery = vaultMovementQuery.lte("created_at", params.to_ts);

  const [
    { data: salesData, error: salesError },
    { data: serviceData, error: serviceError },
    { data: restockData, error: restockError },
    { data: vaultMovementData, error: vaultMovementError },
    { data: productsData },
    { data: categoriesData },
  ] = await Promise.all([
    salesQuery,
    serviceQuery,
    restockQuery,
    vaultMovementQuery,
    // Unfiltered by is_active: a sale of a since-deactivated product should
    // still attribute correctly to its category.
    supabase.from("products").select("id, category_id"),
    supabase.from("categories").select("id, name"),
  ]);

  if (salesError) return <LoadError message={salesError.message} />;
  if (serviceError) return <LoadError message={serviceError.message} />;
  if (restockError) return <LoadError message={restockError.message} />;
  if (vaultMovementError) return <LoadError message={vaultMovementError.message} />;

  const sales = salesData ?? [];
  const serviceList = serviceData ?? [];
  const salesExcludingPersonal = sales.filter((t) => !t.is_personal_take);

  const storeTotal = salesExcludingPersonal.reduce(
    (sum, t) => sum + Number(t.total),
    0
  );
  const eServiceTotal = serviceList.reduce((sum, s) => sum + Number(s.fee), 0);
  const totalRevenue = storeTotal + eServiceTotal;
  const transactionCount = sales.length + serviceList.length;
  const avgSale =
    salesExcludingPersonal.length > 0
      ? storeTotal / salesExcludingPersonal.length
      : 0;
  const itemsSold = salesExcludingPersonal.reduce(
    (sum, t) =>
      sum + t.transaction_items.reduce((n, item) => n + item.quantity, 0),
    0
  );
  const personalTakesValue = sales
    .filter((t) => t.is_personal_take)
    .reduce((sum, t) => sum + Number(t.total), 0);

  // Real profit, not gross revenue: a store sale's line only has a known
  // margin once its product has been restocked through the app at least
  // once (unit_cost is snapshotted from products.cost at sale time — see
  // migration 0021). Older sales and products never restocked here have
  // unit_cost = null, so their revenue is tracked separately and excluded
  // from the margin math rather than silently assumed to be 100% profit.
  // E-Service fees have no COGS to subtract — the fee itself is the whole
  // margin, same as IncomeBreakdownCard already treats it.
  let storeRevenueWithKnownCost = 0;
  let storeCogs = 0;
  let storeRevenueWithUnknownCost = 0;
  for (const t of salesExcludingPersonal) {
    for (const item of t.transaction_items) {
      const lineRevenue = Number(item.line_total);
      if (item.unit_cost !== null) {
        storeRevenueWithKnownCost += lineRevenue;
        storeCogs += Number(item.unit_cost) * item.quantity;
      } else {
        storeRevenueWithUnknownCost += lineRevenue;
      }
    }
  }
  const storeMargin = storeRevenueWithKnownCost - storeCogs;
  const grossProfit = storeMargin + eServiceTotal;

  // E-Service fee income by wallet — same shape/reasoning as the dashboard's
  // IncomeBreakdownCard, just range-scoped instead of daily.
  const eServiceFees: EServiceFees = { gcash: 0, maya: 0, other: 0 };
  for (const s of serviceList) {
    const fee = Number(s.fee);
    if (s.wallet === "gcash") eServiceFees.gcash += fee;
    else if (s.wallet === "maya") eServiceFees.maya += fee;
    else eServiceFees.other += fee;
  }

  // Revenue by which account it actually landed in — a sale's full total for
  // its payment_method, but only the FEE (not the pass-through principal)
  // for a service, since that's the part that's actually store income.
  const paymentRevenue = new Map<MoneyAccount, number>();
  for (const t of salesExcludingPersonal) {
    if (!t.payment_method) continue;
    paymentRevenue.set(
      t.payment_method,
      (paymentRevenue.get(t.payment_method) ?? 0) + Number(t.total)
    );
  }
  for (const s of serviceList) {
    paymentRevenue.set(
      s.payment_account,
      (paymentRevenue.get(s.payment_account) ?? 0) + Number(s.fee)
    );
  }

  const restockSpend = (restockData ?? []).reduce(
    (sum, r) => sum + Number(r.cost),
    0
  );
  const restockUnits = (restockData ?? []).reduce(
    (sum, r) => sum + r.quantity,
    0
  );

  // Deposits/withdrawals stay separate (not netted) — "how much did I add"
  // and "how much did I take out" are different questions. Withdrawals are
  // stored as negative amounts; flipped here so the display value reads
  // positive.
  let depositsTotal = 0;
  let withdrawalsTotal = 0;
  const depositsByAccount = new Map<MoneyAccount, number>();
  const withdrawalsByAccount = new Map<MoneyAccount, number>();
  for (const entry of vaultMovementData ?? []) {
    const amount = Number(entry.amount);
    if (entry.entry_type === "deposit") {
      depositsTotal += amount;
      depositsByAccount.set(
        entry.account,
        (depositsByAccount.get(entry.account) ?? 0) + amount
      );
    } else if (entry.entry_type === "withdrawal") {
      withdrawalsTotal += -amount;
      withdrawalsByAccount.set(
        entry.account,
        (withdrawalsByAccount.get(entry.account) ?? 0) + -amount
      );
    }
  }

  // Category attribution reflects each product's CURRENT category, not its
  // category at time of sale — products don't snapshot that history.
  const categoryNameById = new Map(
    (categoriesData ?? []).map((c) => [c.id, c.name])
  );
  const categoryIdByProductId = new Map(
    (productsData ?? []).map((p) => [p.id, p.category_id])
  );

  const productAgg = new Map<string, { name: string; units: number; revenue: number }>();
  const categoryRevenue = new Map<string, number>();

  for (const t of salesExcludingPersonal) {
    for (const item of t.transaction_items) {
      const revenue = Number(item.line_total);

      const productKey = item.product_id ?? `name:${item.product_name}`;
      const existing = productAgg.get(productKey);
      if (existing) {
        existing.units += item.quantity;
        existing.revenue += revenue;
      } else {
        productAgg.set(productKey, {
          name: item.product_name,
          units: item.quantity,
          revenue,
        });
      }

      const categoryId = item.product_id
        ? categoryIdByProductId.get(item.product_id)
        : null;
      const categoryName = categoryId
        ? (categoryNameById.get(categoryId) ?? "Uncategorized")
        : "Uncategorized";
      categoryRevenue.set(
        categoryName,
        (categoryRevenue.get(categoryName) ?? 0) + revenue
      );
    }
  }

  const topProducts: TopProduct[] = [...productAgg.entries()]
    .map(([key, v]) => ({ key, name: v.name, units: v.units, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const categoryRows: CategoryRevenue[] = [...categoryRevenue.entries()]
    .map(([name, revenue]) => ({ key: name, name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const buckets = buildRevenueBuckets(
    sales,
    serviceList,
    params.from_ts,
    params.to_ts
  );

  const subtitle = rangeSubtitle(params.from, params.to);

  return (
    <PageShell>
      <>
        <h1 className="text-xl font-semibold">Statistics</h1>

        <TransactionFilters
          initial={{ q: "", from: params.from ?? "", to: params.to ?? "" }}
          basePath="/statistics"
          showSearch={false}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryCard label="Total revenue" value={formatPeso(totalRevenue)} compact />
          <SummaryCard
            label="Gross profit"
            value={formatPeso(grossProfit)}
            breakdown={[
              { label: "Store margin", value: formatPeso(storeMargin) },
              { label: "E-Service fees", value: formatPeso(eServiceTotal) },
              ...(storeRevenueWithUnknownCost > 0
                ? [
                    {
                      label: "Cost unknown (excluded)",
                      value: formatPeso(storeRevenueWithUnknownCost),
                    },
                  ]
                : []),
            ]}
            compact
          />
          <SummaryCard label="Transactions" value={String(transactionCount)} compact />
          <SummaryCard label="Average sale" value={formatPeso(avgSale)} compact />
          <SummaryCard label="Items sold" value={String(itemsSold)} compact />
          <SummaryCard
            label="Personal takes"
            value={formatPeso(personalTakesValue)}
            compact
          />
          <SummaryCard
            label="Restock spend"
            value={formatPeso(restockSpend)}
            breakdown={[{ label: "Units restocked", value: String(restockUnits) }]}
            compact
          />
        </div>

        <RevenueTrendChart title="Revenue trend" subtitle={subtitle} buckets={buckets} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <IncomeBreakdownCard
            title="Income"
            subtitle={subtitle}
            store={storeTotal}
            eService={eServiceFees}
          />
          <PaymentBreakdownCard
            title="By payment method"
            subtitle={subtitle}
            revenue={paymentRevenue}
          />
        </div>

        <TopProductsTable title="Top-selling products" products={topProducts} />

        <CategoryLeaderboard
          title="Sales by category"
          subtitle="Reflects each product's current category, not its category at time of sale."
          categories={categoryRows}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SummaryCard
            label="Cash deposited"
            value={formatPeso(depositsTotal)}
            breakdown={ACCOUNT_ORDER.map((account) => ({
              label: MONEY_ACCOUNT_LABELS[account],
              value: formatPeso(depositsByAccount.get(account) ?? 0),
            }))}
          />
          <SummaryCard
            label="Cash withdrawn"
            value={formatPeso(withdrawalsTotal)}
            breakdown={ACCOUNT_ORDER.map((account) => ({
              label: MONEY_ACCOUNT_LABELS[account],
              value: formatPeso(withdrawalsByAccount.get(account) ?? 0),
            }))}
          />
        </div>
      </>
    </PageShell>
  );
}
