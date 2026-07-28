import { EmptyState } from "@/components/emptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPeso } from "@/lib/format";

export type TopProduct = {
  key: string;
  name: string;
  units: number;
  revenue: number;
};

/** Self-contained card (own border/title), matching MoneyBreakdownCard's
    recipe so every section on the statistics page reads the same. Reused
    for both "Top-selling products" and the e-service breakdown — the only
    thing that differs between them is the column/empty-state wording. */
export default function TopProductsTable({
  title,
  products,
  itemHeader = "Product",
  unitsHeader = "Units",
  emptyTitle = "No sales in this window yet.",
}: {
  title: string;
  products: TopProduct[];
  itemHeader?: string;
  unitsHeader?: string;
  emptyTitle?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-sm text-muted-foreground">{title}</p>
      {products.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{itemHeader}</TableHead>
              <TableHead className="text-right">{unitsHeader}</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.key}>
                <TableCell className="max-w-40 truncate whitespace-normal">
                  {product.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {product.units}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPeso(product.revenue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
