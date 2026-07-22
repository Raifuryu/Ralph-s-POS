import { EmptyState } from "@/components/emptyState";
import { Badge } from "@/components/ui/badge";
import {
  formatPeso,
  formatTime,
  friendlyDayLabel,
  storeDayKey,
} from "@/lib/format";
import {
  PAYMENT_METHOD_LABELS,
  type TransactionWithItems,
} from "@/lib/types";

type DayGroup = {
  key: string;
  label: string;
  total: number;
  transactions: TransactionWithItems[];
};

/**
 * Groups by calendar day in the STORE's timezone — grouping by server-local
 * dates would split days at 8am Manila once deployed on a UTC host.
 * Transactions arrive newest-first, so groups come out newest-first too.
 */
function groupByDay(transactions: TransactionWithItems[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const transaction of transactions) {
    const key = storeDayKey(transaction.created_at);
    // Personal takes carry a retail value in `total` for record-keeping, but
    // it's not income — the day total should only ever reflect real sales.
    const income = transaction.is_personal_take ? 0 : Number(transaction.total);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.transactions.push(transaction);
      current.total += income;
    } else {
      groups.push({
        key,
        label: friendlyDayLabel(transaction.created_at),
        total: income,
        transactions: [transaction],
      });
    }
  }
  return groups;
}

function TransactionBlock({
  transaction,
}: {
  transaction: TransactionWithItems;
}) {
  const tendered =
    transaction.tendered !== null ? Number(transaction.tendered) : null;
  return (
    // Indented under the day header: the eye reads date → time as levels.
    <div className="-mx-2 border-b px-2 py-2.5 pl-3 transition-colors last:border-b-0 hover:bg-muted/50">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {formatTime(transaction.created_at)}
          <span className="ml-2 font-normal text-muted-foreground">
            {transaction.is_personal_take
              ? "Personal take"
              : PAYMENT_METHOD_LABELS[transaction.payment_method!]}
          </span>
        </p>
        <p className="text-sm font-semibold tabular-nums">
          {formatPeso(Number(transaction.total))}
        </p>
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        {transaction.transaction_items.map((item) => (
          <div
            key={item.id}
            className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
          >
            <span className="min-w-0 truncate">
              {item.product_name}
              <span className="tabular-nums">
                {" "}
                · {item.quantity} × {formatPeso(Number(item.unit_price))}
              </span>
            </span>
            <span className="tabular-nums">
              {formatPeso(Number(item.line_total))}
            </span>
          </div>
        ))}
      </div>

      {tendered !== null ? (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          Given {formatPeso(tendered)} · change{" "}
          {formatPeso(tendered - Number(transaction.total))}
        </p>
      ) : null}
    </div>
  );
}

export default function TransactionTable({
  transactions,
}: {
  transactions: TransactionWithItems[];
}) {
  if (transactions.length === 0) {
    return <EmptyState title="No sales recorded yet." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {groupByDay(transactions).map((group) => (
        <section
          key={group.key}
          className="rounded-lg border bg-card px-4 py-2"
        >
          <div className="flex items-baseline justify-between gap-2 border-b pb-2 pt-1">
            <h3 className="text-sm font-semibold">
              {group.label}{" "}
              <Badge className="ml-1">
                {group.transactions.length} sale
                {group.transactions.length === 1 ? "" : "s"}
              </Badge>
            </h3>
            <p className="text-sm font-semibold tabular-nums">
              {formatPeso(group.total)}
            </p>
          </div>
          {group.transactions.map((transaction) => (
            <TransactionBlock key={transaction.id} transaction={transaction} />
          ))}
        </section>
      ))}
    </div>
  );
}
