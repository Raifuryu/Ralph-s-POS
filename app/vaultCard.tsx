import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

export default function VaultCard({
  balances,
  todayTransfersIn,
  takenToday,
  compact = false,
  className,
}: {
  balances: Map<MoneyAccount, number>;
  /** Today's total transferred INTO each account (entry_type='transfer',
      the account-arriving leg — see page.tsx's own transferredInTodayRows
      query) — shown as a small greyed-out figure beside that row's
      balance, e.g. "₱123,456.00 (₱123.00)", so money that moved in via a
      transfer today doesn't just silently shift the headline number.
      Omitted (or zero) rows show no parenthetical at all — only the Sales
      dashboard passes this today. */
  todayTransfersIn?: Map<MoneyAccount, number>;
  /** Today's total TAKEN from each account (entry_type='withdrawal' only —
      cash-in/adjustment/transfer aren't "taken", see page.tsx's own
      takenTodayRows query) — the footer below, one line per account that
      had at least one withdrawal today. Replaces this card's old Profit/
      For Restock footer (that breakdown lives on the Vault page's own fund
      cards now, with a "today" figure of its own). Omitted or empty hides
      the footer entirely, same "no divider over nothing" rule the old
      funds footer followed. Only the Sales dashboard passes this today. */
  takenToday?: Map<MoneyAccount, number>;
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

  const takenRows = ACCOUNT_ORDER.filter(
    (account) => (takenToday?.get(account) ?? 0) > 0
  );

  return (
    <MoneyBreakdownCard
      title="Money on hand"
      total={total}
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
        takenRows.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Today&rsquo;s cash activity
            </p>
            {takenRows.map((account) => (
              <p
                key={account}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="text-muted-foreground">
                  {MONEY_ACCOUNT_LABELS[account]}
                </span>
                <span className="font-medium tabular-nums text-destructive">
                  −{formatPeso(takenToday?.get(account) ?? 0)} taken
                </span>
              </p>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}
