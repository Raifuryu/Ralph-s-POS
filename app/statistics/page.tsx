import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
import { type MultiSelectOption } from "@/components/multiSelectDropdown";
import { ACCOUNT_ORDER } from "@/lib/accountColors";
import {
  formatHourLabel,
  formatPeso,
  formatShortDate,
  rangeSubtitle,
  storeDateFromKey,
  storeDayKey,
  storeHour,
  storeWeekday,
  WEEKDAY_ORDER,
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
import ProductAnalysis, { type ProductTimeStats } from "./productAnalysis";
import ProductScopeFilter from "./productScopeFilter";
import ProfitTrendChart, { type ProfitBucket } from "./profitTrendChart";
import { type DailyProfitRow } from "./profitTrendTableSheet";
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
  /** Comma-joined category/product/service ids — see ProductScopeFilter. */
  categories?: string;
  products?: string;
  services?: string;
};

/** Only the columns this page's service_transactions query actually
    selects — narrower than the full ServiceTransaction row type. */
type ServiceRevenuePoint = {
  service_id: string | null;
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

type ProfitPoint = {
  ts: number;
  store: number;
  eService: number;
  /** Cost recovered on this point's known-cost lines — the reinvest side
      of checkout.ts's own per-sale fund split (reinvestPortion). Zero for
      an e-service point: the fee already IS its margin, no COGS to
      recover. */
  cost: number;
};

/** One point per (unvoided, non-personal-take) sale or service, filtered by
    the page's category/product/service scope — shared by buildProfitBuckets
    (the chart, width-capped and grouped by store-day) and
    buildDailyProfitRows (the "Table" sheet, one real row per day). A sale's
    margin/cost are summed only over line items with a known unit_cost AND
    accepted by `matchesItem` — same "cost unknown lines are excluded, not
    assumed 100% margin" rule the Gross profit KPI and every other profit
    figure on this page already follows. `services` has already had the
    page's own Service filter applied by the caller (effectiveServiceList),
    so this needs no e-service-specific filtering of its own. */
function buildProfitPoints(
  sales: TransactionWithItems[],
  services: ServiceRevenuePoint[],
  matchesItem: (item: TransactionItem) => boolean
): ProfitPoint[] {
  return [
    ...sales
      .filter((t) => !t.is_personal_take && !t.voided_at)
      .map((t) => {
        let margin = 0;
        let cost = 0;
        for (const item of t.transaction_items) {
          if (!matchesItem(item)) continue;
          if (item.unit_cost !== null) {
            const lineCost = Number(item.unit_cost) * item.quantity;
            margin += Number(item.line_total) - lineCost;
            cost += lineCost;
          }
        }
        return {
          ts: new Date(t.created_at).getTime(),
          store: margin,
          eService: 0,
          cost,
        };
      }),
    ...services.map((s) => ({
      ts: new Date(s.created_at).getTime(),
      store: 0,
      eService: Number(s.fee),
      cost: 0,
    })),
  ];
}

/** Buckets `points`' store+eService PROFIT (not revenue, and not `cost` —
    the chart only ever shows the store/e-service margin split, see its own
    STORE_COLOR/ESERVICE_COLOR stacking) by store-day into a chart-ready
    series. Bounds come from the requested from/to date keys when both are
    set, else from the data's own earliest/latest timestamp (so "all time"
    on a young store doesn't try to render decades of empty bars). Widens
    buckets past MAX_BARS so long ranges stay readable. */
function buildProfitBuckets(
  points: ProfitPoint[],
  fromKey: string | undefined,
  toKey: string | undefined
): ProfitBucket[] {
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

/** Real per-day rows for the "Table" sheet under the Profit trend chart —
    unlike buildProfitBuckets, never widens past a single day regardless of
    range length, since a scrollable table doesn't share the chart's
    fixed-bar-width constraint. Newest first, same order every other
    history-style sheet in this app uses. Days with nothing matching the
    current filters (profit and forRestock both zero) are dropped rather
    than shown as an empty row — the chart still renders a zero-height bar
    for them, but a bare "₱0.00 / ₱0.00" table row carries no information
    and would just be noise to scroll past. */
function buildDailyProfitRows(points: ProfitPoint[]): DailyProfitRow[] {
  const byDay = new Map<string, { ts: number; profit: number; forRestock: number }>();
  for (const point of points) {
    const key = storeDayKey(new Date(point.ts));
    const profit = point.store + point.eService;
    const existing = byDay.get(key);
    if (existing) {
      existing.profit += profit;
      existing.forRestock += point.cost;
    } else {
      byDay.set(key, { ts: point.ts, profit, forRestock: point.cost });
    }
  }
  return [...byDay.entries()]
    .filter(([, v]) => v.profit !== 0 || v.forRestock !== 0)
    .sort((a, b) => b[1].ts - a[1].ts)
    .map(([key, v]) => ({
      key,
      label: formatShortDate(storeDateFromKey(key)),
      profit: v.profit,
      forRestock: v.forRestock,
    }));
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

  // Category/product/service scope — narrows every figure on this page down
  // to just matching transaction_items/service_transactions (see
  // matchesItemFilter/matchesServiceFilter below), not only the tables.
  // Comma-encoded in a single param each (see ProductScopeFilter) rather
  // than repeated query keys. Category and Product are one facet (a
  // product's own category), Service is a separate, unrelated one — see
  // the comments on hasCategoryOrProductFilter/hasServiceFilter below for
  // how an inactive facet behaves once ANY filter is applied.
  const selectedCategories = new Set(
    (params.categories ?? "").split(",").filter(Boolean)
  );
  const selectedProducts = new Set(
    (params.products ?? "").split(",").filter(Boolean)
  );
  const selectedServices = new Set(
    (params.services ?? "").split(",").filter(Boolean)
  );
  const hasCategoryOrProductFilter =
    selectedCategories.size > 0 || selectedProducts.size > 0;
  const hasServiceFilter = selectedServices.size > 0;
  const hasAnyFilter = hasCategoryOrProductFilter || hasServiceFilter;

  let sales: TransactionWithItems[];
  let serviceData: ServiceRevenuePoint[];
  let restockData: {
    product_id: string | null;
    cost: number;
    quantity: number;
    created_at: string;
  }[];
  let vaultMovementData: {
    amount: number;
    account: MoneyAccount;
    entry_type: "deposit" | "withdrawal";
    created_at: string;
  }[];
  let productsData: { id: string; name: string; category_id: string | null }[];
  let categoriesData: { id: string; name: string }[];
  let servicesData: { id: string; name: string }[];

  try {
    let transactions: Transaction[];
    [
      transactions,
      serviceData,
      restockData,
      vaultMovementData,
      productsData,
      categoriesData,
      servicesData,
    ] = await Promise.all([
        queryRows<Transaction>(
          `SELECT ${TRANSACTION_COLUMNS} FROM transactions ${dateWhere} ORDER BY created_at ASC`,
          dateParams
        ),
        queryRows<ServiceRevenuePoint>(
          `SELECT service_id, fee, wallet, payment_account, created_at, voided_at, service_name, unit_label, unit_quantity
           FROM service_transactions ${dateWhere} ORDER BY created_at ASC`,
          dateParams
        ),
        queryRows<{
          product_id: string | null;
          cost: number;
          quantity: number;
          created_at: string;
        }>(
          `SELECT product_id, cost, quantity, created_at FROM product_restocks ${dateWhere}`,
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
        // Unfiltered by is_active: a sale of a since-deactivated product
        // should still attribute correctly to its category, and should
        // still be pickable in the Product filter below for past sales.
        queryRows<{ id: string; name: string; category_id: string | null }>(
          "SELECT id, name, category_id FROM products ORDER BY name"
        ),
        queryRows<{ id: string; name: string }>(
          "SELECT id, name FROM categories ORDER BY name"
        ),
        // Unfiltered by is_active too — a since-deactivated service's past
        // transactions should still be pickable in the Service filter.
        queryRows<{ id: string; name: string }>(
          "SELECT id, name FROM services ORDER BY name"
        ),
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

  // Category attribution reflects each product's CURRENT category, not its
  // category at time of sale — products don't snapshot that history. Built
  // up front (not after the aggregation loops, like this page used to)
  // since matchesItemFilter itself needs it.
  const categoryNameById = new Map(categoriesData.map((c) => [c.id, c.name]));
  const categoryIdByProductId = new Map(
    productsData.map((p) => [p.id, p.category_id])
  );

  // A line item matches the filter if its product is one of the selected
  // products OR its (current) category is one of the selected categories —
  // a union across both facets, not an intersection: picking a category
  // plus one extra product outside it shows the category's items AND that
  // product, rather than narrowing to their overlap (which could easily be
  // empty and confusing). If Category/Product has no selections at all but
  // Service does, every store item is excluded — the filter deliberately
  // scoped the page to services instead, same reasoning e-service used to
  // get zeroed out by a category/product-only filter. No filter selected
  // anywhere matches everything, so every figure below collapses back to
  // exactly its old unfiltered value.
  function matchesItemFilter(item: TransactionItem): boolean {
    if (!hasAnyFilter) return true;
    if (!hasCategoryOrProductFilter) return false;
    if (
      selectedProducts.size > 0 &&
      item.product_id !== null &&
      selectedProducts.has(item.product_id)
    ) {
      return true;
    }
    if (selectedCategories.size > 0 && item.product_id !== null) {
      const categoryId = categoryIdByProductId.get(item.product_id);
      if (categoryId && selectedCategories.has(categoryId)) return true;
    }
    return false;
  }

  // Mirrors matchesItemFilter, for the Service facet: matches only when
  // Service has selections and this transaction's service_id is one of
  // them. A service with no service_id on the row (a deleted service — see
  // ServiceTransaction.service_id) can't be attributed to a selection, so
  // it's excluded while filtering rather than guessed at, same "gap stays
  // visible" rule as a cost-unknown sale or an unattributed restock.
  function matchesServiceFilter(s: ServiceRevenuePoint): boolean {
    if (!hasAnyFilter) return true;
    if (!hasServiceFilter) return false;
    return s.service_id !== null && selectedServices.has(s.service_id);
  }

  // A voided service transaction had every entry it posted reversed — same
  // "excluded everywhere" treatment as a voided/personal-take sale.
  const serviceList = serviceData.filter((s) => !s.voided_at);
  const effectiveServiceList = serviceList.filter(matchesServiceFilter);

  // A voided sale had its stock and any posted income both reversed — it
  // isn't real revenue, demand, or a "transaction that happened" anymore,
  // so it's excluded the same way personal takes already are everywhere a
  // sum/count/average is computed below.
  const nonVoidedSales = sales.filter((t) => !t.voided_at);
  const salesExcludingPersonal = nonVoidedSales.filter((t) => !t.is_personal_take);

  // costKnownRevenue/cost mirror storeRevenueWithKnownCost/storeCogs below,
  // but per product — a line only contributes to profit once its unit_cost
  // is known.
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

  // "Customers" ≈ each individual sale/service action, bucketed by hour of
  // day (store timezone) to surface when the store is actually busiest. A
  // sale only counts toward its hour once it has at least one matching item
  // (see the `touched` flag in the loop below), same "touched" definition
  // Transactions/Average sale use.
  const hourlyTraffic: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHourLabel(hour),
    store: 0,
    eService: 0,
  }));

  const productAgg = new Map<string, ProductAggEntry>();
  const categoryRevenue = new Map<string, number>();
  // Same per-product aggregation as productAgg above, but scoped per
  // category — powers the click-to-expand item breakdown under each row in
  // CategoryLeaderboard.
  const categoryProductAgg = new Map<string, Map<string, ProductAggEntry>>();
  // When (day of week, hour of day) a product tends to sell — powers
  // ProductAnalysis's per-item breakdown below. Keyed the same way as
  // productAgg; bucketed by the transaction's timestamp since that's when
  // the sale actually happened, not by anything about the line item itself.
  const productTimeAgg = new Map<
    string,
    { name: string; units: number; byWeekday: number[]; byHour: number[] }
  >();
  // Revenue by which account it actually landed in — a sale's (filtered)
  // revenue for its payment_method, plus only the FEE (not the pass-through
  // principal) for a service, since that's the part that's actually store
  // income.
  const paymentRevenue = new Map<MoneyAccount, number>();

  // Real profit, not gross revenue: a store sale's line only has a known
  // margin once its product has been restocked through the app at least
  // once (unit_cost is snapshotted from products.cost at sale time). Older
  // sales and products never restocked here have unit_cost = null, so their
  // revenue is tracked separately and excluded from the margin math rather
  // than assumed to be 100% profit. Every figure accumulated in this loop is
  // summed ONLY over items matchesItemFilter accepts — with no filter
  // active that's every item, so nothing here changes from before.
  let storeTotal = 0;
  let storeRevenueWithKnownCost = 0;
  let storeCogs = 0;
  let storeRevenueWithUnknownCost = 0;
  let itemsSold = 0;
  const touchedSaleIds = new Set<string>();

  for (const t of salesExcludingPersonal) {
    const weekdayIndex = WEEKDAY_ORDER.indexOf(storeWeekday(t.created_at));
    const hourIndex = storeHour(t.created_at);
    let transactionRevenue = 0;
    let touched = false;

    for (const item of t.transaction_items) {
      if (!matchesItemFilter(item)) continue;
      touched = true;

      const revenue = Number(item.line_total);
      const unitCost = item.unit_cost !== null ? Number(item.unit_cost) : null;
      const productKey = item.product_id ?? `name:${item.product_name}`;

      transactionRevenue += revenue;
      itemsSold += item.quantity;
      if (unitCost !== null) {
        storeRevenueWithKnownCost += revenue;
        storeCogs += unitCost * item.quantity;
      } else {
        storeRevenueWithUnknownCost += revenue;
      }

      bumpProductAgg(
        productAgg,
        productKey,
        item.product_name,
        item.quantity,
        revenue,
        unitCost
      );

      const timeEntry = productTimeAgg.get(productKey) ?? {
        name: item.product_name,
        units: 0,
        byWeekday: Array(7).fill(0) as number[],
        byHour: Array(24).fill(0) as number[],
      };
      timeEntry.units += item.quantity;
      timeEntry.byWeekday[weekdayIndex] += item.quantity;
      timeEntry.byHour[hourIndex] += item.quantity;
      productTimeAgg.set(productKey, timeEntry);

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

    if (touched) {
      touchedSaleIds.add(t.id);
      storeTotal += transactionRevenue;
      hourlyTraffic[hourIndex].store += 1;
      if (t.payment_method) {
        paymentRevenue.set(
          t.payment_method,
          (paymentRevenue.get(t.payment_method) ?? 0) + transactionRevenue
        );
      }
    }
  }
  const storeMargin = storeRevenueWithKnownCost - storeCogs;

  // A personal take is valued at cost, not price (see checkout()'s own
  // "no income" comment). Filtering narrows this the same way as a real
  // sale: only the cost of matching items within each take counts, and a
  // take only counts toward Transactions once it has at least one.
  let personalTakesValue = 0;
  const touchedPersonalTakeIds = new Set<string>();
  for (const t of nonVoidedSales) {
    if (!t.is_personal_take) continue;
    let matchedCost = 0;
    let touched = false;
    for (const item of t.transaction_items) {
      if (!matchesItemFilter(item)) continue;
      touched = true;
      if (item.unit_cost !== null) {
        matchedCost += Number(item.unit_cost) * item.quantity;
      }
    }
    if (touched) {
      touchedPersonalTakeIds.add(t.id);
      personalTakesValue += matchedCost;
    }
  }

  const eServiceTotal = effectiveServiceList.reduce(
    (sum, s) => sum + Number(s.fee),
    0
  );
  const totalRevenue = storeTotal + eServiceTotal;
  const transactionCount =
    touchedSaleIds.size + touchedPersonalTakeIds.size + effectiveServiceList.length;
  const avgSale = touchedSaleIds.size > 0 ? storeTotal / touchedSaleIds.size : 0;
  const grossProfit = storeMargin + eServiceTotal;

  // E-Service fee income by wallet — same shape/reasoning as the dashboard's
  // IncomeBreakdownCard, just range-scoped instead of daily. Empty whenever
  // effectiveServiceList is (a category/product-only filter, or a Service
  // filter matching nothing in this window).
  const eServiceFees: EServiceFees = { gcash: 0, maya: 0, other: 0 };
  for (const s of effectiveServiceList) {
    const fee = Number(s.fee);
    if (s.wallet === "gcash") eServiceFees.gcash += fee;
    else if (s.wallet === "maya") eServiceFees.maya += fee;
    else eServiceFees.other += fee;
  }
  for (const s of effectiveServiceList) {
    paymentRevenue.set(
      s.payment_account,
      (paymentRevenue.get(s.payment_account) ?? 0) + Number(s.fee)
    );
  }
  for (const s of effectiveServiceList) {
    hourlyTraffic[storeHour(s.created_at)].eService += 1;
  }

  // A restock is attributable the same way a sold line is — via its own
  // product_id (and that product's current category). A restock for a
  // brand-new item (no product_id yet — see recordBulkRestock) can't be
  // attributed to anything, so it's excluded while a filter is active
  // rather than guessed at, same "gap stays visible" rule as cost-unknown
  // revenue above.
  function restockMatchesFilter(row: { product_id: string | null }): boolean {
    if (!hasAnyFilter) return true;
    if (!hasCategoryOrProductFilter) return false;
    if (
      selectedProducts.size > 0 &&
      row.product_id !== null &&
      selectedProducts.has(row.product_id)
    ) {
      return true;
    }
    if (selectedCategories.size > 0 && row.product_id !== null) {
      const categoryId = categoryIdByProductId.get(row.product_id);
      if (categoryId && selectedCategories.has(categoryId)) return true;
    }
    return false;
  }
  const filteredRestockData = restockData.filter(restockMatchesFilter);
  const restockSpend = filteredRestockData.reduce(
    (sum, r) => sum + Number(r.cost),
    0
  );
  const restockUnits = filteredRestockData.reduce(
    (sum, r) => sum + r.quantity,
    0
  );

  // Deposits/withdrawals stay separate (not netted) — "how much did I add"
  // and "how much did I take out" are different questions. Withdrawals are
  // stored as negative amounts; flipped here so the display value reads
  // positive. Unlike a restock, a vault deposit/withdrawal has no product,
  // category, or service of its own at all (not even indirectly) — while
  // any filter is active these are zeroed rather than shown as whole-store
  // numbers next to filtered ones.
  let depositsTotal = 0;
  let withdrawalsTotal = 0;
  const depositsByAccount = new Map<MoneyAccount, number>();
  const withdrawalsByAccount = new Map<MoneyAccount, number>();
  if (!hasAnyFilter) {
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
  }

  // Every product sold in the window, revenue-highest first — not curated
  // down to a "top 10" anymore, so the table (and its Total row) reflect
  // everything, not just the leaders. TopProductsTable's own "show more"
  // reveals the rest a page at a time.
  const topProducts: TopProduct[] = [...productAgg.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      units: v.units,
      revenue: v.revenue,
      profit: productProfit(v),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const productAnalysis: ProductTimeStats[] = [...productTimeAgg.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      units: v.units,
      byWeekday: v.byWeekday,
      byHour: v.byHour,
    }))
    .sort((a, b) => b.units - a.units);

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
  // transaction count — there's no natural quantity for a GCash load. Empty
  // whenever effectiveServiceList is.
  const serviceAgg = new Map<string, { units: number; revenue: number }>();
  for (const s of effectiveServiceList) {
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

  const profitPoints = buildProfitPoints(
    sales,
    effectiveServiceList,
    matchesItemFilter
  );
  const buckets = buildProfitBuckets(profitPoints, params.from, params.to);
  const dailyProfitRows = buildDailyProfitRows(profitPoints);

  const peakHour = hourlyTraffic.reduce((best, b) =>
    b.store + b.eService > best.store + best.eService ? b : best
  );
  const peakHourTotal = peakHour.store + peakHour.eService;
  const peakHourSubtitle =
    peakHourTotal > 0
      ? `Busiest: ${peakHour.label}–${formatHourLabel((peakHour.hour + 1) % 24)}, ${peakHourTotal} customer${peakHourTotal === 1 ? "" : "s"}`
      : undefined;

  const subtitle = rangeSubtitle(params.from, params.to);

  const categoryOptions: MultiSelectOption[] = categoriesData.map((c) => ({
    key: c.id,
    name: c.name,
  }));
  const productOptions: MultiSelectOption[] = productsData.map((p) => ({
    key: p.id,
    name: p.name,
  }));
  const serviceOptions: MultiSelectOption[] = servicesData.map((s) => ({
    key: s.id,
    name: s.name,
  }));
  const preserveParams: Record<string, string> = {};
  if (params.from) preserveParams.from = params.from;
  if (params.to) preserveParams.to = params.to;
  if (params.from_ts) preserveParams.from_ts = params.from_ts;
  if (params.to_ts) preserveParams.to_ts = params.to_ts;

  return (
    <PageShell>
      <>
        <h1 className="text-xl font-semibold">Statistics</h1>

        <TransactionFilters
          initial={{ q: "", from: params.from ?? "", to: params.to ?? "" }}
          basePath="/statistics"
          showSearch={false}
        />

        <ProductScopeFilter
          categoryOptions={categoryOptions}
          productOptions={productOptions}
          serviceOptions={serviceOptions}
          initialCategories={[...selectedCategories]}
          initialProducts={[...selectedProducts]}
          initialServices={[...selectedServices]}
          basePath="/statistics"
          preserveParams={preserveParams}
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

        <ProfitTrendChart
          title="Profit trend"
          subtitle={subtitle}
          buckets={buckets}
          dailyRows={dailyProfitRows}
        />

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
            invested={storeCogs}
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
          title="Products"
          products={topProducts}
          emptyTitle={
            hasServiceFilter && !hasCategoryOrProductFilter
              ? "Products aren't tied to a service, so they're excluded while filtering by service."
              : "No sales in this window yet."
          }
        />

        <TopProductsTable
          key={`services-${subtitle}`}
          title="E-Services"
          products={serviceBreakdown}
          itemHeader="Service"
          unitsHeader="Qty"
          emptyTitle={
            hasCategoryOrProductFilter && !hasServiceFilter
              ? "E-Service isn't tied to a product or category, so it's excluded while filtering."
              : "No e-service transactions in this window yet."
          }
        />

        <CategoryLeaderboard
          title="Sales by category"
          subtitle="Reflects each product's current category, not its category at time of sale."
          categories={categoryRows}
        />

        <ProductAnalysis key={`analysis-${subtitle}`} products={productAnalysis} />

        {hasAnyFilter ? (
          <p className="text-xs text-muted-foreground">
            Cash deposits/withdrawals aren&rsquo;t tied to a product,
            category, or service, so they&rsquo;re excluded while filtering.
          </p>
        ) : null}
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
