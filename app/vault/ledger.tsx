import { EmptyState } from "@/components/emptyState";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatPeso } from "@/lib/format";
import {
  MONEY_ACCOUNT_LABELS,
  VAULT_ENTRY_TYPE_LABELS,
  type VaultEntry,
} from "@/lib/types";

export type LedgerEntry = VaultEntry & {
  service_transactions: { service_name: string } | null;
};

function entryLabel(entry: LedgerEntry): string {
  if (entry.entry_type === "service" && entry.service_transactions) {
    return entry.service_transactions.service_name;
  }
  return VAULT_ENTRY_TYPE_LABELS[entry.entry_type];
}

/** Counted vs expected line under a count entry; null for other entries. */
function countResult(entry: LedgerEntry) {
  if (entry.entry_type !== "count" || entry.expected === null) return null;
  const diff = Number(entry.amount) - Number(entry.expected);
  return {
    expected: Number(entry.expected),
    diff,
    className:
      diff === 0
        ? "text-muted-foreground"
        : diff > 0
          ? "text-success"
          : "text-destructive",
    text:
      diff === 0
        ? "exact"
        : diff > 0
          ? `over ${formatPeso(diff)}`
          : `short ${formatPeso(-diff)}`,
  };
}

function AmountCell({ entry }: { entry: LedgerEntry }) {
  const amount = Number(entry.amount);
  if (entry.entry_type === "count") {
    return (
      <TableCell className="text-right font-medium tabular-nums">
        = {formatPeso(amount)}
      </TableCell>
    );
  }
  return (
    <TableCell
      className={
        amount < 0
          ? "text-right tabular-nums text-destructive"
          : "text-right tabular-nums"
      }
    >
      {amount > 0 ? "+" : "−"}
      {formatPeso(Math.abs(amount))}
    </TableCell>
  );
}

export default function Ledger({
  entries,
  filtered = false,
}: {
  entries: LedgerEntry[];
  /** True when a date/search filter is active — changes the empty-state copy. */
  filtered?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title={filtered ? "No entries match this filter." : "No vault activity yet."}
        subtitle={
          filtered
            ? undefined
            : "Cash sales and services will appear here automatically."
        }
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Entry</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const count = countResult(entry);
          return (
            <TableRow key={entry.id}>
              <TableCell className="text-muted-foreground">
                {formatDateTime(entry.created_at)}
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="font-medium">{entryLabel(entry)}</span>{" "}
                <Badge>{MONEY_ACCOUNT_LABELS[entry.account]}</Badge>
                {entry.note ? (
                  <span className="block text-xs text-muted-foreground">
                    {entry.note}
                  </span>
                ) : null}
                {count ? (
                  <span className={`block text-xs ${count.className}`}>
                    expected {formatPeso(count.expected)} · {count.text}
                  </span>
                ) : null}
              </TableCell>
              <AmountCell entry={entry} />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
