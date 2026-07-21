import Link from "next/link";

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
import { createClient } from "@/lib/supabase/server";
import { MONEY_ACCOUNT_LABELS, type Product, type Service } from "@/lib/types";
import ItemsBrowser from "./itemsBrowser";
import ProductSheet from "./productSheet";
import RestockHistorySheet, {
  type RestockHistoryEntry,
} from "./restockHistorySheet";
import ServiceDeleteButton from "./serviceDeleteButton";
import ServiceForm from "./serviceForm";

type SearchParams = {
  new?: string;
  edit?: string;
  tab?: string;
  newService?: string;
  editService?: string;
  history?: string;
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data, error }, { data: categories }, { data: services }] =
    await Promise.all([
      supabase
        .from("products")
        .select(
          "id, name, price, stock, description, category_id, is_active, created_at, updated_at"
        )
        .order("name"),
      supabase
        .from("categories")
        .select("id, name, sort_order, created_at")
        .order("sort_order"),
      supabase
        .from("services")
        .select(
          "id, name, cash_flow, default_fee, wallet, allowed_payment_accounts, is_active, created_at, updated_at"
        )
        .order("name"),
    ]);

  if (error) {
    return (
      <PageError title="Could not load inventory" message={error.message} />
    );
  }

  const products: Product[] = data ?? [];
  const serviceList: Service[] = services ?? [];

  const editing = params.edit
    ? products.find((p) => p.id === params.edit)
    : undefined;
  const showProductForm = params.new !== undefined || editing !== undefined;

  const editingService = params.editService
    ? serviceList.find((s) => s.id === params.editService)
    : undefined;
  const showServiceForm =
    params.newService !== undefined || editingService !== undefined;

  const defaultTab =
    params.tab === "services" || showServiceForm ? "services" : "items";

  const historyProduct = params.history
    ? products.find((p) => p.id === params.history)
    : undefined;
  const showHistory = params.history !== undefined;

  let historyEntries: RestockHistoryEntry[] = [];
  if (params.history) {
    const [{ data: restocks, error: restocksError }, { data: items, error: itemsError }] =
      await Promise.all([
        supabase
          .from("product_restocks")
          .select("id, quantity, cost, note, created_at")
          .eq("product_id", params.history)
          .order("created_at", { ascending: false }),
        supabase
          .from("transaction_items")
          .select("line_total, transactions(created_at)")
          .eq("product_id", params.history)
          .overrideTypes<
            { line_total: number; transactions: { created_at: string } | null }[],
            { merge: false }
          >(),
      ]);

    if (restocksError) {
      return (
        <PageError
          title="Could not load restock history"
          message={restocksError.message}
        />
      );
    }
    if (itemsError) {
      return (
        <PageError
          title="Could not load restock history"
          message={itemsError.message}
        />
      );
    }

    // Sales attributed to a batch = this product's revenue from the batch's
    // created_at onward. An earlier batch's window overlaps a later batch's,
    // so the same sale can count toward both — see the caveat in the sheet.
    const sales = (items ?? [])
      .filter((item) => item.transactions !== null)
      .map((item) => ({
        lineTotal: Number(item.line_total),
        soldAt: new Date(item.transactions!.created_at).getTime(),
      }));

    historyEntries = (restocks ?? []).map((restock) => {
      const restockedAt = new Date(restock.created_at).getTime();
      const recovered = sales
        .filter((sale) => sale.soldAt >= restockedAt)
        .reduce((sum, sale) => sum + sale.lineTotal, 0);
      return {
        id: restock.id,
        quantity: restock.quantity,
        cost: Number(restock.cost),
        note: restock.note,
        created_at: restock.created_at,
        recovered,
      };
    });
  }

  return (
    <PageShell>
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Inventory</h1>
          <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>
            Sales
          </Button>
        </div>

        <Tabs defaultValue={defaultTab} className="w-full min-w-0">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="services">E-Services</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="flex min-w-0 flex-col gap-4 pt-3">
            <Button
              className="self-start"
              nativeButton={false}
              render={<Link href="/inventory?new" />}
            >
              Add item
            </Button>

            <ItemsBrowser products={products} categories={categories ?? []} />
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
              <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
                No services yet.
              </p>
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
          categories={categories ?? []}
        />

        <RestockHistorySheet
          open={showHistory}
          productName={historyProduct?.name}
          entries={historyEntries}
        />
      </>
    </PageShell>
  );
}
