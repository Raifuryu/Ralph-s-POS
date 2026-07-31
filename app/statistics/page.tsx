import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { ACCOUNT_ORDER } from "@/lib/accountColors";
import {
  formatDate,
  formatHourLabel,
  formatPeso,
  formatShortDate,
  friendlyDayLabel,
  storeDateFromKey,
  storeDayKey,
  storeHour,
} from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import {
  MONEY_ACCOUNT_LABELS,
  type MoneyAccount,
  type Transaction,
  type TransactionItem,
  type TransactionWithItems,
} from "@/lib/types";
import IncomeBreakdownCard, { type EServiceFees } from "@/app/incomeBreakdownCard";
import TransactionFilters from "@/app/transactionFilters";
import CategoryLeaderboard, { type CategoryRevenue } from "./categoryLeaderboard";
import HourlyTrafficChart, { type HourlyBucket } from "./hourlyTrafficChart";
import PaymentBreakdownCard from "./paymentBreakdownCard";
import ProfitTrendChart, { type ProfitBucket } from "./profitTrendChart";
import TopProductsTable, { type TopProduct } from "./topProductsTable";

const TRANSACTION_COLUMNS =
  "id, payment_method, cashier_id, total, tendered, created_at, is_personal_take, voided_at, voided_by, void_reason, visit_id";
const TRANSACTION_ITEM_COLUMNS =
  "id, transaction_id, product_id, product_name, unit_price, unit_cost, quantity, discount_amount, line_total";

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
  voided_at: string | null;
  service_name: string;
  unit_label: string | null;
  unit_quantity: number | null;
};

function LoadError({ message }: { message: string }) {
  return (
    <PageError
      title="Could not load statistics"
      message={message}
      hint={
        <>
          If this says a table is missing, the schema in{" "}
          <code className="text-xs">mariadb/schema.sql</code> has not been
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

/** Buckets sale + service PROFIT (not revenue) by store-day into a
    chart-ready series. A sale's contribution is its margin, summed only
    over line items with a known unit_cost — same "cost unknown lines are
    excluded, not assumed 100% margin" rule the Gross profit KPI and every
    other profit figure on this page already follows. An e-service's
    contribution is its fee as-is, since the fee already IS its margin (no
    COGS to subtract). Bounds come from the requested from/to date keys when
    both are set, else from the data's own earliest/latest timestamp (so
    "all time" on a young store doesn't try to render decades of empty
    bars). Widens buckets past MAX_BARS so long ranges stay readable. */
function buildProfitBuckets(
  sales: TransactionWithItems[],
  services: ServiceRevenuePoint[],
  fromKey: string | undefined,
  toKey: string | undefined
): ProfitBucket[] {
  const points = [
    ...sales
      .filter((t) => !t.is_personal_take && !t.voided_at)
      .map((t) => {
        let margin = 0;
        for (const item of t.transaction_items) {
          if (item.unit_cost !== null) {
            margin += Number(item.line_total) - Number(item.unit_cost) * item.quantity;
          }
        }
        return {
          ts: new Date(t.created_at).getTime(),
          store: margin,
          eService: 0,
        };
      }),
    ...services.map((s) => ({
      ts: new Date(s.created_at).getTime(),
      store: 0,
      eService: Number(s.fee),
    })),
  ];

  let startDate: Date;
  let endDate: Date;
  if (fromKey && toKey) {
    // Pass the plain "YYYY-MM-DD" keys straight to storeDateFromKey rather
    // than parsing a *_ts timestamp string here — that string is a naive
    // local literal (see the comment on TransactionFilters' apply()), and
    // `new Date(naiveString)` is implementation-defined parsing that only
    // happens to land right because this process's TZ is pinned to Manila.
    // storeDateFromKey is explicit and host-timezone-independent by design.
    startDate = storeDateFromKey(fromKey);
    endDate = storeDateFromKey(toKey);
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

  const buckets: ProfitBucket[] = Array.from({ length: bucketCount }, (_, i) => {
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

  const dateConditions: string[] = [];
  const dateParams: string[] = [];
  if (params.from_ts) {
    dateConditions.push("created_at >= ?");
    dateParams.push(params.from_ts);
  }
  if (params.to_ts) {
    dateConditions.push("created_at <= ?");
    dateParams.push(params.to_ts);
  }
  const dateWhere = dateConditions.length > 0 ? `WHERE ${dateConditions.join(" AND ")}` : "";

  let sales: TransactionWithItems[];
  let serviceData: ServiceRevenuePoint[];
  let restockData: { cost: number; quantity: number; created_at: string }[];
  let vaultMovementData: {
    amount: number;
    account: MoneyAccount;
    entry_type: "deposit" | "withdrawal";
    created_at: string;
  }[];
  let productsData: { id: string; category_id: string | null }[];
  let categoriesData: { id: string; name: string }[];

  try {
    let transactions: Transaction[];
    [transactions, serviceData, restockData, vaultMovementData, productsData, categoriesData] =
      await Promise.all([
        queryRows<Transaction>(
          `SELECT ${TRANSACTION_COLUMNS} FROM transactions ${dateWhere} ORDER BY created_at ASC`,
          dateParams
        ),
        queryRows<ServiceRevenuePoint>(
          `SELECT fee, wallet, payment_account, created_at, voided_at, service_name, unit_label, unit_quantity
           FROM service_transactions ${dateWhere} ORDER BY created_at ASC`,
          dateParams
        ),
        queryRows<{ cost: number; quantity: number; created_at: string }>(
          `SELECT cost, quantity, created_at FROM product_restocks ${dateWhere}`,
          dateParams
        ),
        queryRows<{
          amount: number;
          account: MoneyAccount;
          entry_type: "deposit" | "withdrawal";
          created_at: string;
        }>(
          `SELECT amount, account, entry_type, created_at FROM vault_entries
           ${dateWhere ? `${dateWhere} AND` : "WHERE"} entry_type IN ('deposit', 'withdrawal')`,
          dateParams
        ),
        // Unfiltered by is_active: a sale of a since-deactivated product should
        // still attribute correctly to its category.
        queryRows<{ id: string; category_id: string | null }>(
          "SELECT id, category_id FROM products"
        ),
        queryRows<{ id: string; name: string }>("SELECT id, name FROM categories"),
      ]);

    const itemsByTxnId = new Map<string, TransactionItem[]>();
    if (transactions.length > 0) {
      const items = await queryRows<TransactionItem>(
        `SELECT ${TRANSACTION_ITEM_COLUMNS} FROM transaction_items WHERE transaction_id IN (${transactions.map(() => "?").join(",")})`,
        transactions.map((t) => t.id)
      );
      for (const item of items) {
        const list = itemsByTxnId.get(item.transaction_id);
        if (list) list.push(item);
        else itemsByTxnId.set(item.transaction_id, [item]);
      }
    }
    sales = transactions.map((t) => ({
      ...t,
      transaction_items: itemsByTxnId.get(t.id) ?? [],
    }));
  } catch (err) {
    return <LoadError message={(err as Error).message} />;
  }

  // A voided service transaction had every entry it posted reversed — same
  // "excluded everywhere" treatment as a voided/personal-take sale.
  const serviceList = serviceData.filter((s) => !s.voided_at);
  // A voided sale had its stock and any posted income both reversed — it
  // isn't real revenue, demand, or a "transaction that happened" anymore,
  // so it's excluded the same way personal takes already are everywhere a
  // sum/count/average is computed below.
  const nonVoidedSales = sales.filter((t) => !t.voided_at);
  const salesExcludingPersonal = nonVoidedSales.filter((t) => !t.is_personal_take);

  const storeTotal = salesExcludingPersonal.reduce(
    (sum, t) => sum + Number(t.total),
    0
  );
  const eServiceTotal = serviceList.reduce((sum, s) => sum + Number(s.fee), 0);
  const totalRevenue = storeTotal + eServiceTotal;
  const transactionCount = nonVoidedSales.length + serviceList.length;
  const avgSale =
    salesExcludingPersonal.length > 0
      ? storeTotal / salesExcludingPersonal.length
      : 0;
  const itemsSold = salesExcludingPersonal.reduce(
    (sum, t) =>
      sum + t.transaction_items.reduce((n, item) => n + item.quantity, 0),
    0
  );
  const personalTakesValue = nonVoidedSales
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

  const restockSpend = restockData.reduce(
    (sum, r) => sum + Number(r.cost),
    0
  );
  const restockUnits = restockData.reduce(
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
  for (const entry of vaultMovementData) {
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
    categoriesData.map((c) => [c.id, c.name])
  );
  const categoryIdByProductId = new Map(
    productsData.map((p) => [p.id, p.category_id])
  );

  // costKnownRevenue/cost mirror the storeRevenueWithKnownCost/storeCogs
  // split above, but per product — a line only contributes to profit once
  // its unit_cost is known (see the comment on that split for why).
  type ProductAggEntry = {
    name: string;
    units: number;
    revenue: number;
    costKnownRevenue: number;
    cost: number;
  };
  function bumpProductAgg(
    map: Map<string, ProductAggEntry>,
    key: string,
    name: string,
    quantity: number,
    revenue: number,
    unitCost: number | null
  ) {
    const entry = map.get(key) ?? {
      name,
      units: 0,
      revenue: 0,
      costKnownRevenue: 0,
      cost: 0,
    };
    entry.units += quantity;
    entry.revenue += revenue;
    if (unitCost !== null) {
      entry.costKnownRevenue += revenue;
      entry.cost += unitCost * quantity;
    }
    map.set(key, entry);
  }
  function productProfit(entry: ProductAggEntry): number | null {
    return entry.costKnownRevenue > 0
      ? entry.costKnownRevenue - entry.cost
      : null;
  }

  const productAgg = new Map<string, ProductAggEntry>();
  const categoryRevenue = new Map<string, number>();
  // Same per-product aggregation as productAgg above, but scoped per
  // category — powers the click-to-expand item breakdown under each row in
  // CategoryLeaderboard.
  const categoryProductAgg = new Map<string, Map<string, ProductAggEntry>>();

  for (const t of salesExcludingPersonal) {
    for (const item of t.transaction_items) {
      const revenue = Number(item.line_total);
      const unitCost = item.unit_cost !== null ? Number(item.unit_cost) : null;
      const productKey = item.product_id ?? `name:${item.product_name}`;

      bumpProductAgg(
        productAgg,
        productKey,
        item.product_name,
        item.quantity,
        revenue,
        unitCost
      );

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

      let categoryProducts = categoryProductAgg.get(categoryName);
      if (!categoryProducts) {
        categoryProducts = new Map();
        categoryProductAgg.set(categoryName, categoryProducts);
      }
      bumpProductAgg(
        categoryProducts,
        productKey,
        item.product_name,
        item.quantity,
        revenue,
        unitCost
      );
    }
  }

  const topProducts: TopProduct[] = [...productAgg.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      units: v.units,
      revenue: v.revenue,
      profit: productProfit(v),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const categoryRows: CategoryRevenue[] = [...categoryRevenue.entries()]
    .map(([name, revenue]) => ({
      key: name,
      name,
      revenue,
      items: [...(categoryProductAgg.get(name)?.entries() ?? [])]
        .map(([key, v]) => ({
          key,
          name: v.name,
          units: v.units,
          revenue: v.revenue,
          profit: productProfit(v),
        }))
        .sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Same "grouped by what was actually sold" idea as topProducts above, but
  // for services — a per-unit service breaks out per variant (its unit_label
  // snapshot), so Xerox's Black & White and Colored show as separate rows.
  // "Units" for a flat/tiered service (no unit_label) falls back to a plain
  // transaction count — there's no natural quantity for a GCash load.
  const serviceAgg = new Map<string, { units: number; revenue: number }>();
  for (const s of serviceList) {
    const key = s.unit_label ? `${s.service_name} — ${s.unit_label}` : s.service_name;
    const existing = serviceAgg.get(key);
    const units = s.unit_quantity ?? 1;
    const revenue = Number(s.fee);
    if (existing) {
      existing.units += units;
      existing.revenue += revenue;
    } else {
      serviceAgg.set(key, { units, revenue });
    }
  }
  const serviceBreakdown: TopProduct[] = [...serviceAgg.entries()]
    .map(([name, v]) => ({ key: name, name, units: v.units, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const buckets = buildProfitBuckets(sales, serviceList, params.from, params.to);

  // "Customers" ≈ each individual sale/service action, same units already
  // summed into the Transactions summary card above — just bucketed by hour
  // of day (store timezone) instead of totalled across the whole window, to
  // surface when the store is actually busiest.
  const hourlyTraffic: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHourLabel(hour),
    store: 0,
    eService: 0,
  }));
  for (const t of salesExcludingPersonal) {
    hourlyTraffic[storeHour(t.created_at)].store += 1;
  }
  for (const s of serviceList) {
    hourlyTraffic[storeHour(s.created_at)].eService += 1;
  }
  const peakHour = hourlyTraffic.reduce((best, b) =>
    b.store + b.eService > best.store + best.eService ? b : best
  );
  const peakHourTotal = peakHour.store + peakHour.eService;
  const peakHourSubtitle =
    peakHourTotal > 0
      ? `Busiest: ${peakHour.label}–${formatHourLabel((peakHour.hour + 1) % 24)}, ${peakHourTotal} customer${peakHourTotal === 1 ? "" : "s"}`
      : undefined;

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

        <ProfitTrendChart title="Profit trend" subtitle={subtitle} buckets={buckets} />

        <HourlyTrafficChart
          title="Busiest times of day"
          subtitle={peakHourSubtitle}
          buckets={hourlyTraffic}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <IncomeBreakdownCard
            title="Income"
            subtitle={subtitle}
            store={storeTotal}
            eService={eServiceFees}
            personalTake={personalTakesValue}
          />
          <PaymentBreakdownCard
            title="By payment method"
            subtitle={subtitle}
            revenue={paymentRevenue}
          />
        </div>

        <TopProductsTable
          key={`products-${subtitle}`}
          title="Top-selling products"
          products={topProducts}
        />

        <TopProductsTable
          key={`services-${subtitle}`}
          title="E-Services"
          products={serviceBreakdown}
          itemHeader="Service"
          unitsHeader="Qty"
          emptyTitle="No e-service transactions in this window yet."
        />

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
