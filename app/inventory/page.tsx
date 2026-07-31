import Link from "next/link";

import { EmptyState } from "@/components/emptyState";
import { PageError, PageShell } from "@/components/pageShell";
import { SummaryCard } from "@/components/summaryCard";
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
import {
  MONEY_ACCOUNT_LABELS,
  type Category,
  type MoneyAccount,
  type Product,
  type Service,
} from "@/lib/types";
import BulkRestockSheet from "./bulkRestockSheet";
import HistorySheet, { type HistoryEntry } from "./historySheet";
import ItemsBrowser from "./itemsBrowser";
import ProductSheet from "./productSheet";
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
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Empty string and undefined both mean "no history sheet" — one value
  // drives both the open state and the fetch below, so they can't disagree.
  const historyId = params.history || undefined;

  let products: Product[];
  let categories: Category[];
  let serviceList: Service[];
  let restocks: RestockRow[];
  let items: ProductSaleRow[];

  try {
    [products, categories, serviceList, restocks, items] = await Promise.all([
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
    ]);
  } catch (err) {
    return (
      <PageError title="Could not load inventory" message={(err as Error).message} />
    );
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

  const showBulkRestock = params.bulk !== undefined;

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
  let remaining = sales.reduce((sum, sale) => sum + sale.lineTotal, 0);
  let saleIdx = 0;
  const recoveredById = new Map<string, number>();
  for (const restock of restocksAsc) {
    const restockedAt = new Date(restock.created_at).getTime();
    while (saleIdx < sales.length && sales[saleIdx].soldAt < restockedAt) {
      remaining -= sales[saleIdx].lineTotal;
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

  // Money currently tied up in stock, and the profit (not gross revenue) if
  // every unit on the shelf sold at its current price — active,
  // currently-stocked items only (null stock means "never counted,"
  // negative means "oversold, needs a recount," and a deactivated product
  // isn't real inventory anymore). A product only has a known cost once
  // it's been restocked through the app at least once; unknownCost* tracks
  // how much that gap leaves out of both figures, same "cost unknown"
  // convention Statistics already uses for Gross profit.
  let totalInvested = 0;
  let potentialRevenue = 0;
  let unknownCostValue = 0;
  let unknownCostItems = 0;
  let trackedItems = 0;
  for (const product of products) {
    if (!product.is_active || product.stock === null || product.stock <= 0) {
      continue;
    }
    trackedItems++;
    const lineValue = Number(product.price) * product.stock;
    potentialRevenue += lineValue;
    if (product.cost !== null) {
      totalInvested += Number(product.cost) * product.stock;
    } else {
      unknownCostItems++;
      unknownCostValue += lineValue;
    }
  }
  // Profit only over the cost-known portion — the unknown-cost slice of
  // potentialRevenue has no matching cost to subtract, so it's excluded
  // rather than assumed to be 100% margin.
  const potentialProfit = potentialRevenue - unknownCostValue - totalInvested;

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
            {trackedItems > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SummaryCard
                  label="Total invested"
                  value={formatPeso(totalInvested)}
                  breakdown={
                    unknownCostItems > 0
                      ? [
                          {
                            label: "Cost unknown (excluded)",
                            value: `${unknownCostItems} item${unknownCostItems === 1 ? "" : "s"}`,
                          },
                        ]
                      : undefined
                  }
                />
                <SummaryCard
                  label="Potential profit"
                  value={formatPeso(potentialProfit)}
                  breakdown={[
                    { label: "If every item in stock sold", value: `${trackedItems} item${trackedItems === 1 ? "" : "s"}` },
                    ...(unknownCostItems > 0
                      ? [
                          {
                            label: "Cost unknown (excluded)",
                            value: `${unknownCostItems} item${unknownCostItems === 1 ? "" : "s"}`,
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            ) : null}

            <Button
              className="self-start"
              nativeButton={false}
              render={<Link href="/inventory?bulk" />}
            >
              Bulk restock
            </Button>

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
        />
      </>
    </PageShell>
  );
}
