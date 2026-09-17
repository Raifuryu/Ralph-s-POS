import Link from "next/link";

import { EmptyState } from "@/components/emptyState";
import { PageError, PageShell } from "@/components/pageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatPeso } from "@/lib/format";
import { queryRows } from "@/lib/mysql/pool";
import { roundMoney } from "@/lib/pricing";
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
  type Category,
  type MoneyAccount,
  type Product,
  type ProfitFund,
  type Service,
} from "@/lib/types";
import BulkRestockSheet from "./bulkRestockSheet";
import HistorySheet, { type HistoryEntry } from "./historySheet";
import ItemsBrowser from "./itemsBrowser";
import ProductSheet from "./productSheet";
import RestockHistorySheet, {
  type RestockPaymentItem,
  type RestockReceipt,
  type RestockReceiptLine,
} from "./restockHistorySheet";
import ServiceDeleteButton from "./serviceDeleteButton";
import ServiceForm from "./serviceForm";

const PRODUCT_COLUMNS =
  "id, name, price, cost, stock, description, category_id, low_stock_threshold, expiry_date, is_active, created_at, updated_at";
const SERVICE_COLUMNS =
  "id, name, cash_flow, default_fee, fee_tiers, wallet, allowed_payment_accounts, pricing_mode, unit_prices, is_active, created_at, updated_at";

type RestockRow = {
  id: string;
  quantity: number;
  cost: number;
  note: string | null;
  created_at: string;
};

/** Flattened join of transaction_items + its parent transaction — replaces
    the PostgREST nested `transactions(...)` embed. INNER JOIN is safe here:
    transaction_id is NOT NULL with ON DELETE CASCADE, so every line item
    always has exactly one parent row. */
type ProductSaleRow = {
  id: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
  created_at: string;
  is_personal_take: boolean;
  voided_at: string | null;
  void_reason: string | null;
  payment_method: MoneyAccount | null;
};

type SearchParams = {
  edit?: string;
  tab?: string;
  newService?: string;
  editService?: string;
  history?: string;
  bulk?: string;
  restocks?: string;
};

// Every product_restocks row now carries restock_batch — a real id shared
// by every line (and every payment vault_entries row) from the same
// recordBulkRestock() call (see restock_batch's own comment in
// mariadb/schema.sql) — so a batch-tagged row groups on that alone, exactly.
// Rows written before that column existed (restock_batch NULL) fall back to
// the old heuristic: same cashier + identical created_at, since every line
// in one call lands inside one DB transaction and TIMESTAMP here has no
// fractional-second precision. Two different cashiers restocking in the
// exact same second would wrongly merge under the fallback, but that's not
// a real scenario for this store, and it only applies to pre-migration data
// anyway.
const RESTOCK_HISTORY_LIMIT = 1000;

function groupIntoReceipts(
  rows: (RestockReceiptLine & { cashier_id: string })[]
): RestockReceipt[] {
  const receipts: RestockReceipt[] = [];
  for (const row of rows) {
    const last = receipts[receipts.length - 1];
    const sameBatch =
      last && row.restock_batch !== null && last.restockBatch === row.restock_batch;
    const sameLegacyGroup =
      last &&
      row.restock_batch === null &&
      last.restockBatch === null &&
      last.createdAt === row.created_at &&
      last.cashierId === row.cashier_id;
    if (last && (sameBatch || sameLegacyGroup)) {
      last.lines.push(row);
      last.totalCost += Number(row.cost);
      last.totalUnits += row.quantity;
    } else {
      receipts.push({
        key: row.id,
        restockBatch: row.restock_batch,
        createdAt: row.created_at,
        cashierId: row.cashier_id,
        lines: [row],
        totalCost: Number(row.cost),
        totalUnits: row.quantity,
        // Filled in below, once the payment vault_entries rows for these
        // batches are fetched — grouping and payment attribution are
        // separate passes over the same data.
        paymentBreakdown: [],
        ownerCovered: 0,
      });
    }
  }
  return receipts;
}

type RestockPaymentRow = {
  restock_batch: string;
  amount: number;
  account: MoneyAccount;
  fund: ProfitFund | null;
  wallet_id: string | null;
  wallet_name: string | null;
};

/** Turns the raw payment vault_entries rows for a set of batches into each
    receipt's own paymentBreakdown + ownerCovered — see RestockReceipt's own
    comments for what each means. A receipt with no restockBatch (legacy
    data) is left untouched (still the [] / 0 groupIntoReceipts gave it) —
    there's nothing to correlate it to. */
function attachPayments(
  receipts: RestockReceipt[],
  paymentRows: RestockPaymentRow[]
): RestockReceipt[] {
  const byBatch = new Map<string, RestockPaymentItem[]>();
  for (const row of paymentRows) {
    const amount = roundMoney(Number(row.amount));
    const item: RestockPaymentItem = row.fund
      ? { key: row.fund, label: PROFIT_FUND_LABELS[row.fund], amount }
      : row.wallet_id
        ? { key: row.wallet_id, label: row.wallet_name ?? "Wallet", amount }
        : { key: row.account, label: MONEY_ACCOUNT_LABELS[row.account], amount };
    const existing = byBatch.get(row.restock_batch);
    if (existing) existing.push(item);
    else byBatch.set(row.restock_batch, [item]);
  }

  return receipts.map((receipt) => {
    if (!receipt.restockBatch) return receipt;
    const paymentBreakdown = byBatch.get(receipt.restockBatch) ?? [];
    const paid = paymentBreakdown.reduce((sum, item) => sum + item.amount, 0);
    const ownerCovered = Math.max(0, roundMoney(receipt.totalCost - paid));
    return { ...receipt, paymentBreakdown, ownerCovered };
  });
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Empty string and undefined both mean "no history sheet" — one value
  // drives both the open state and the fetch below, so they can't disagree.
  const historyId = params.history || undefined;
  const showRestockHistory = params.restocks !== undefined;
  const showBulkRestock = params.bulk !== undefined;

  let products: Product[];
  let categories: Category[];
  let serviceList: Service[];
  let restocks: RestockRow[];
  let items: ProductSaleRow[];
  let restockHistoryRows: (RestockReceiptLine & { cashier_id: string })[];
  let vaultBalanceRows: { account: MoneyAccount; balance: number }[];
  let fundBalanceRows: { fund: ProfitFund; balance: number }[];
  let activeWalletRows: { wallet_id: string; name: string; balance: number }[];

  try {
    [
      products,
      categories,
      serviceList,
      restocks,
      items,
      restockHistoryRows,
      vaultBalanceRows,
      fundBalanceRows,
      activeWalletRows,
    ] = await Promise.all([
        queryRows<Product>(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY name`),
        queryRows<Category>(
          "SELECT id, name, sort_order, created_at FROM categories ORDER BY sort_order"
        ),
        queryRows<Service>(`SELECT ${SERVICE_COLUMNS} FROM services ORDER BY name`),
        // History is independent of the queries above (keyed only by
        // ?history=), so it rides in the same Promise.all instead of waiting
        // on them to resolve first.
        historyId
          ? queryRows<RestockRow>(
              "SELECT id, quantity, cost, note, created_at FROM product_restocks WHERE product_id = ? ORDER BY created_at DESC",
              [historyId]
            )
          : Promise.resolve([]),
        historyId
          ? queryRows<ProductSaleRow>(
              `SELECT ti.id, ti.quantity, ti.unit_price, ti.discount_amount, ti.line_total,
                    t.created_at, t.is_personal_take, t.voided_at, t.void_reason, t.payment_method
             FROM transaction_items ti
             JOIN transactions t ON t.id = ti.transaction_id
             WHERE ti.product_id = ?`,
              [historyId]
            )
          : Promise.resolve([]),
        // Also independent of everything above (keyed only by ?restocks),
        // and only worth fetching when that sheet is actually open — same
        // "don't pay for a query nobody's looking at" reasoning as history.
        showRestockHistory
          ? queryRows<RestockReceiptLine & { cashier_id: string }>(
              `SELECT id, product_id, product_name, quantity, cost, note, cashier_id, created_at, restock_batch
             FROM product_restocks
             ORDER BY created_at DESC, id ASC
             LIMIT ${RESTOCK_HISTORY_LIMIT}`
            )
          : Promise.resolve([]),
        // The bulk restock form's own "paid with" balances — only worth
        // fetching while that sheet is actually open, same reasoning as
        // history/restocks above.
        showBulkRestock
          ? queryRows<{ account: MoneyAccount; balance: number }>(
              "SELECT account, balance FROM vault_balance"
            )
          : Promise.resolve([]),
        showBulkRestock
          ? queryRows<{ fund: ProfitFund; balance: number }>(
              "SELECT fund, balance FROM vault_fund_balance"
            )
          : Promise.resolve([]),
        // Active wallets only — an archived one can't pay for a restock
        // (see wallets' own comment in mariadb/schema.sql).
        showBulkRestock
          ? queryRows<{ wallet_id: string; name: string; balance: number }>(
              "SELECT wallet_id, name, balance FROM wallet_balance WHERE is_active = 1 ORDER BY name"
            )
          : Promise.resolve([]),
      ]);
  } catch (err) {
    return (
      <PageError title="Could not load inventory" message={(err as Error).message} />
    );
  }

  let restockReceipts = groupIntoReceipts(restockHistoryRows);

  // Payment breakdown for exactly the batches just grouped above — a
  // separate query for exactly the batch ids already selected (same "child
  // rows for the parent ids we have" pattern the dashboard's own
  // transaction_items follow-up query uses), so this never runs when the
  // sheet is closed (restockReceipts is then empty) or when nothing visible
  // has a real batch id yet (all-legacy data).
  const batchIds = [
    ...new Set(
      restockReceipts
        .map((receipt) => receipt.restockBatch)
        .filter((id): id is string => id !== null)
    ),
  ];
  if (batchIds.length > 0) {
    try {
      const paymentRows = await queryRows<RestockPaymentRow>(
        `SELECT ve.restock_batch, -ve.amount AS amount, ve.account, ve.fund, ve.wallet_id, w.name AS wallet_name
         FROM vault_entries ve
         LEFT JOIN wallets w ON w.id = ve.wallet_id
         WHERE ve.restock_batch IN (${batchIds.map(() => "?").join(",")})`,
        batchIds
      );
      restockReceipts = attachPayments(restockReceipts, paymentRows);
    } catch (err) {
      return (
        <PageError title="Could not load inventory" message={(err as Error).message} />
      );
    }
  }

  const editing = params.edit
    ? products.find((p) => p.id === params.edit)
    : undefined;
  const showProductForm = editing !== undefined;

  const editingService = params.editService
    ? serviceList.find((s) => s.id === params.editService)
    : undefined;
  const showServiceForm =
    params.newService !== undefined || editingService !== undefined;

  const defaultTab =
    params.tab === "services" || showServiceForm ? "services" : "items";

  const historyProduct = historyId
    ? products.find((p) => p.id === historyId)
    : undefined;
  const showHistory = historyId !== undefined;

  const vaultBalances = new Map(
    vaultBalanceRows
      .filter((row): row is typeof row & { account: MoneyAccount } => row.account !== null)
      .map((row) => [row.account, Number(row.balance ?? 0)])
  );
  const fundBalances = new Map(
    fundBalanceRows.map((row) => [row.fund, Number(row.balance ?? 0)])
  );
  const wallets = activeWalletRows.map((row) => ({
    id: row.wallet_id,
    name: row.name,
    balance: Number(row.balance ?? 0),
  }));

  // Sales attributed to a batch = this product's revenue from the batch's
  // created_at onward. An earlier batch's window overlaps a later batch's,
  // so the same sale can count toward both — see the caveat in the sheet.
  // Voided sales and personal takes are excluded here: neither one actually
  // put cash toward recovering what the batch cost, even though both still
  // appear as their own entries in the history list below.
  const sales = items
    .filter((item) => !item.voided_at && !item.is_personal_take)
    .map((item) => ({
      lineTotal: Number(item.line_total),
      soldAt: new Date(item.created_at).getTime(),
    }))
    .sort((a, b) => a.soldAt - b.soldAt);

  // Recovered-per-batch via one sweep over batches oldest-first: start from
  // the sum of every sale and subtract sales as they fall behind each
  // batch's cutoff, rather than re-scanning all sales per batch.
  const restocksAsc = [...restocks].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  // Rounded on the initial sum and after every subtraction — a running
  // total over many already-2-decimal sale amounts can still drift past
  // the centavo, which would then flip historySheet.tsx's own `net >= 0`
  // right at an exact break-even.
  let remaining = roundMoney(sales.reduce((sum, sale) => sum + sale.lineTotal, 0));
  let saleIdx = 0;
  const recoveredById = new Map<string, number>();
  for (const restock of restocksAsc) {
    const restockedAt = new Date(restock.created_at).getTime();
    while (saleIdx < sales.length && sales[saleIdx].soldAt < restockedAt) {
      remaining = roundMoney(remaining - sales[saleIdx].lineTotal);
      saleIdx++;
    }
    recoveredById.set(restock.id, remaining);
  }

  const historyEntries: HistoryEntry[] = [
    ...restocks.map(
      (restock): HistoryEntry => ({
        kind: "restock",
        id: restock.id,
        quantity: restock.quantity,
        cost: Number(restock.cost),
        note: restock.note,
        created_at: restock.created_at,
        recovered: recoveredById.get(restock.id) ?? 0,
      })
    ),
    ...items.map(
      (item): HistoryEntry => ({
        kind: "sale",
        id: item.id,
        quantity: item.quantity,
        line_total: Number(item.line_total),
        discount_amount: Number(item.discount_amount),
        created_at: item.created_at,
        is_personal_take: item.is_personal_take,
        voided_at: item.voided_at,
        void_reason: item.void_reason,
        payment_method: item.payment_method,
      })
    ),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <PageShell>
      <>
        <h1 className="text-xl font-semibold">Inventory</h1>

        <Tabs defaultValue={defaultTab} className="w-full min-w-0">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="services">E-Services</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="flex min-w-0 flex-col gap-4 pt-3">
            <div className="flex flex-wrap gap-2">
              <Button
                className="self-start"
                nativeButton={false}
                render={<Link href="/inventory?bulk" />}
              >
                Bulk restock
              </Button>
              <Button
                variant="outline"
                className="self-start"
                nativeButton={false}
                render={<Link href="/inventory?restocks" />}
              >
                Restock history
              </Button>
            </div>

            <ItemsBrowser products={products} categories={categories} />
          </TabsContent>

          <TabsContent
            value="services"
            className="flex min-w-0 flex-col gap-4 pt-3"
          >
            {showServiceForm ? (
              <div className="rounded-lg border bg-card p-4">
                <h2 className="mb-4 font-medium">
                  {editingService
                    ? `Edit ${editingService.name}`
                    : "New service"}
                </h2>
                <ServiceForm
                  key={editingService?.id ?? "new-service"}
                  service={editingService}
                />
              </div>
            ) : (
              <Button
                className="self-start"
                nativeButton={false}
                render={<Link href="/inventory?tab=services&newService" />}
              >
                Add service
              </Button>
            )}

            {serviceList.length === 0 ? (
              <EmptyState title="No services yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Usual fee</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serviceList.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{service.name}</span>
                        <Badge className="ml-2">
                          {service.cash_flow === "in" ? "Cash in" : "Cash out"}
                        </Badge>
                        {service.wallet ? (
                          <Badge className="ml-1">
                            {MONEY_ACCOUNT_LABELS[service.wallet]}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {service.default_fee !== null
                          ? formatPeso(Number(service.default_fee))
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            nativeButton={false}
                            render={
                              <Link
                                href={`/inventory?tab=services&editService=${service.id}`}
                              />
                            }
                          >
                            Edit
                          </Button>
                          <ServiceDeleteButton
                            id={service.id}
                            name={service.name}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>

        <ProductSheet
          open={showProductForm}
          product={editing}
          categories={categories}
        />

        <HistorySheet
          open={showHistory}
          productName={historyProduct?.name}
          entries={historyEntries}
        />

        <BulkRestockSheet
          open={showBulkRestock}
          products={products}
          categories={categories}
          vaultBalances={vaultBalances}
          fundBalances={fundBalances}
          wallets={wallets}
        />

        <RestockHistorySheet open={showRestockHistory} receipts={restockReceipts} />
      </>
    </PageShell>
  );
}
