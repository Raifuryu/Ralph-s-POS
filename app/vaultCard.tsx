import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

export type TransferOutItem = { key: string; label: string; amount: number };

export default function VaultCard({
  title = "Money on hand",
  balances,
  todayTransfersIn,
  transfersOut,
  compact = false,
  className,
}: {
  /** The Sales dashboard shows this same Cash/GCash/Maya card as "Baseline
      Fund" instead — everywhere else (Vault page, Vault Snapshot sheet)
      keeps the default. */
  title?: string;
  balances: Map<MoneyAccount, number>;
  /** Today's total transferred INTO each account (entry_type='transfer',
      the account-arriving leg — see page.tsx's own transferredInTodayRows
      query) — shown as a small greyed-out figure beside that row's
      balance, e.g. "₱123,456.00 (₱123.00)", so money that moved in via a
      transfer today doesn't just silently shift the headline number.
      Omitted (or zero) rows show no parenthetical at all — only the Sales
      dashboard passes this today. */
  todayTransfersIn?: Map<MoneyAccount, number>;
  /** Today's transfers OUT of Profit, For Restock, and every wallet — the
      footer below, one line per source with a transfer today (see page.tsx's
      own fundsTransferredOutRows/walletsTransferredOutRows queries and their
      "known imprecision" comment). Not withdrawals/cash-out — only
      entry_type='transfer'. Omitted or empty hides the footer entirely,
      same "no divider over nothing" rule this card's earlier footers have
      followed. Only the Sales dashboard passes this today. */
  transfersOut?: TransferOutItem[];
  compact?: boolean;
  className?: string;
}) {
  const rows = ACCOUNT_ORDER.map((account) => {
    const transferredIn = todayTransfersIn?.get(account) ?? 0;
    return {
      key: account,
      label: MONEY_ACCOUNT_LABELS[account],
      value: balances.get(account) ?? 0,
      color: ACCOUNT_COLORS[account],
      note: transferredIn !== 0 ? formatPeso(transferredIn) : undefined,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  // What the total was before today's incoming transfers — shown beside
  // the headline so e.g. "₱20,692.56 was ₱20,392.56" reads as "GCash's
  // ₱300 transfer today is included in that number." Hidden when nothing
  // transferred in today (todayTransfersIn omitted or all-zero), same "no
  // note over nothing" rule this card's row-level notes already follow.
  const transferredInSum = ACCOUNT_ORDER.reduce(
    (sum, account) => sum + (todayTransfersIn?.get(account) ?? 0),
    0
  );
  const totalBeforeTransfers = total - transferredInSum;

  return (
    <MoneyBreakdownCard
      title={title}
      total={total}
      headlineNote={
        transferredInSum !== 0 ? `was ${formatPeso(totalBeforeTransfers)}` : undefined
      }
      rows={rows}
      afterRows={
        <p className="flex items-baseline justify-between gap-2 text-xs font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatPeso(total)}</span>
        </p>
      }
      href="/vault"
      linkLabel="Vault →"
      compact={compact}
      className={className}
      footer={
        transfersOut && transfersOut.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Today&rsquo;s transfers
            </p>
            {transfersOut.map((item) => (
              <p
                key={item.key}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium tabular-nums text-destructive">
                  −{formatPeso(item.amount)}
                </span>
              </p>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}
