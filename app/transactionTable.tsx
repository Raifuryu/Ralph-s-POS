import { Fragment } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatPeso } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, type TransactionWithItems } from "@/lib/types";

export default function TransactionTable({
  transactions,
}: {
  transactions: TransactionWithItems[];
}) {
  if (transactions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No sales recorded yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Price at sale</TableHead>
          <TableHead className="text-right">Line total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((transaction) => (
          <Fragment key={transaction.id}>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={3} className="font-medium">
                {formatDateTime(transaction.created_at)}
                <span className="ml-2 text-muted-foreground">
                  {PAYMENT_METHOD_LABELS[transaction.payment_method]}
                </span>
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatPeso(transaction.total)}
              </TableCell>
            </TableRow>

            {transaction.transaction_items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="pl-6">{item.product_name}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatPeso(item.unit_price)}
                </TableCell>
                <TableCell className="text-right">
                  {formatPeso(item.line_total)}
                </TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
