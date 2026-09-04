import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

export type TransferOutItem = { key: string; label: string; amount: number };

export default function VaultCard({
  title = "Money on hand",
  balances,
  historyHref,
  openingTotal,
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
  /** Link to the Cash In/Cash Out/Transfer/Adjust history sheet, shown as a
      small "History" link before "Vault →" (see MoneyBreakdownCard's own
      secondaryHref). Omit to hide it — only the Sales dashboard passes this
      today. */
  historyHref?: string;
  /** Cash+GCash+Maya's TRUE opening balance for today — a fixed snapshot
      (see page.tsx's own openingBalanceRows query), not a live "total minus
      today's transfers" that would keep drifting whenever anything else —
      a same-day cash-out, a sale — also changes the total. Shown as the
      headline's own "was ₱X" note whenever it differs from the current
      total. Omit to hide the note entirely — only the Sales dashboard
      passes this today. */
  openingTotal?: number;
  /** Today's total money that came INTO each account — a transfer's
      arriving leg plus a plain Cash in (see page.tsx's own
      transferredInTodayRows query) — shown as a small greyed-out figure
      beside that row's balance, e.g. "₱123,456.00 (₱123.00)", so money
      that moved in today doesn't just silently shift the headline number.
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

  return (
    <MoneyBreakdownCard
      title={title}
      total={total}
      headlineNote={
        openingTotal !== undefined && openingTotal !== total
          ? `was ${formatPeso(openingTotal)}`
          : undefined
      }
      rows={rows}
      href="/vault"
      linkLabel="Vault →"
      secondaryHref={historyHref}
      secondaryLinkLabel="History"
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
