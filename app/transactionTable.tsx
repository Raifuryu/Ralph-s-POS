import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TransactionCategory } from "@/lib/types";

export default function TransactionTable({
  category,
}: {
  category: TransactionCategory;
}) {
  return (
    <>
      <div className="mb-4 text-lg font-semibold">{category} Transactions</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>1</TableCell>
            <TableCell>Item 1</TableCell>
            <TableCell>Item 2</TableCell>
            <TableCell>Item 3</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </>
  );
}
