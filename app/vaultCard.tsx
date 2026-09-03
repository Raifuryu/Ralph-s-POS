import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso, formatTime } from "@/lib/format";
import {
  MONEY_ACCOUNT_LABELS,
  VAULT_ENTRY_TYPE_LABELS,
  type MoneyAccount,
  type VaultEntry,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** The "recent activity" footer's own entry type — deliberately narrower
    than a full VaultEntry: this card only ever queries for (and only ever
    shows) cash out/in/adjustment/transfer rows that actually touched
    Cash/GCash/Maya, see page.tsx's own recentVaultRows query. */
export type RecentVaultEntry = Pick<
  VaultEntry,
  "id" | "entry_type" | "account" | "amount" | "note" | "created_at"
>;

export default function VaultCard({
  balances,
  todayAdjustments,
  recentEntries,
  compact = false,
  className,
}: {
  balances: Map<MoneyAccount, number>;
  /** Today's net adjustment per account (entry_type='adjustment', fund IS
      NULL, DATE(created_at) = CURDATE()) — shown as a small greyed-out
      figure beside that row's balance, e.g. "₱123,456.00 (₱123.00)", so an
      adjustment made today doesn't just silently move the headline number.
      Omitted (or zero) rows show no parenthetical at all — only the Sales
      dashboard passes this today. */
  todayAdjustments?: Map<MoneyAccount, number>;
  /** Up to the 3 latest cash out/in/adjustment/transfer entries today,
      newest first — replaces this card's old Profit/For Restock footer
      (that breakdown lives on the Vault page's own fund cards now, with a
      "today" figure of its own). Omitted or empty hides the footer
      entirely, same "no divider over nothing" rule the old funds footer
      followed. Only the Sales dashboard passes this today. */
  recentEntries?: RecentVaultEntry[];
  compact?: boolean;
  className?: string;
}) {
  const rows = ACCOUNT_ORDER.map((account) => {
    const adjustment = todayAdjustments?.get(account) ?? 0;
    return {
      key: account,
      label: MONEY_ACCOUNT_LABELS[account],
      value: balances.get(account) ?? 0,
      color: ACCOUNT_COLORS[account],
      note: adjustment !== 0 ? formatPeso(adjustment) : undefined,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);

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
        recentEntries && recentEntries.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Today&rsquo;s cash activity
            </p>
            {recentEntries.map((entry) => {
              const amount = Number(entry.amount);
              return (
                <p
                  key={entry.id}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {VAULT_ENTRY_TYPE_LABELS[entry.entry_type]} ·{" "}
                    {MONEY_ACCOUNT_LABELS[entry.account]} ·{" "}
                    {formatTime(entry.created_at)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-medium tabular-nums",
                      amount < 0 && "text-destructive"
                    )}
                  >
                    {amount > 0 ? "+" : "−"}
                    {formatPeso(Math.abs(amount))}
                  </span>
                </p>
              );
            })}
          </div>
        ) : undefined
      }
    />
  );
}
