import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/types";
import DeleteButton from "./deleteButton";
import ProductForm from "./productForm";

type SearchParams = { new?: string; edit?: string };

function Quantity({ value }: { value: number | null }) {
  // NULL and 0 are different states and must not read the same.
  if (value === null) {
    return <span className="text-muted-foreground">Not counted</span>;
  }
  if (value === 0) {
    return <span className="text-destructive">Out of stock</span>;
  }
  return <span className="tabular-nums">{value}</span>;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select("id, name, price, stock, description, is_active, created_at, updated_at")
    .order("name");

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center p-4 sm:p-8 md:p-12">
        <div className="w-full max-w-3xl rounded-lg border border-destructive/50 p-4">
          <h1 className="font-semibold">Could not load inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        </div>
      </main>
    );
  }

  const products: Product[] = data ?? [];
  const editing = params.edit
    ? products.find((p) => p.id === params.edit)
    : undefined;
  const showForm = params.new !== undefined || editing !== undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center p-4 sm:p-8 md:p-12">
      <div className="flex w-full min-w-0 max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Inventory</h1>
          <div className="flex items-center gap-2">
            {!showForm ? (
              <Button nativeButton={false} render={<Link href="/inventory?new" />}>
                Add item
              </Button>
            ) : null}
            <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>
              Sales
            </Button>
          </div>
        </div>

        {showForm ? (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 font-medium">
              {editing ? `Edit ${editing.name}` : "New item"}
            </h2>
            <ProductForm key={editing?.id ?? "new"} product={editing} />
          </div>
        ) : null}

        {products.length === 0 ? (
          <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
            No items yet. Add your first one to start ringing up sales.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{product.name}</span>
                    {product.description ? (
                      <span className="block text-xs text-muted-foreground">
                        {product.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPeso(Number(product.price))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Quantity value={product.stock} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        nativeButton={false}
                        render={<Link href={`/inventory?edit=${product.id}`} />}
                      >
                        Edit
                      </Button>
                      <DeleteButton id={product.id} name={product.name} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </main>
  );
}
