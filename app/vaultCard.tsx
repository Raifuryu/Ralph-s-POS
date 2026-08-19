import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

export default function VaultCard({
  balances,
  compact = false,
  className,
  showTotal = false,
}: {
  balances: Map<MoneyAccount, number>;
  compact?: boolean;
  className?: string;
  /** Adds an explicit "Total" row below the per-account breakdown — off by
      default, since the card's own headline number above already IS this
      total (Sales dashboard/Vault page don't need it repeated). The Vault
      snapshot sheet turns this on since that view pairs this card directly
      against IncomeBreakdownCard's own explicit Income/Total profit rows,
      where an unlabeled headline reads less clearly side by side. */
  showTotal?: boolean;
}) {
  const rows = ACCOUNT_ORDER.map((account) => ({
    key: account,
    label: MONEY_ACCOUNT_LABELS[account],
    value: balances.get(account) ?? 0,
    color: ACCOUNT_COLORS[account],
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <MoneyBreakdownCard
      title="Money on hand"
      total={total}
      rows={rows}
      href="/vault"
      linkLabel="Vault →"
      compact={compact}
      className={className}
      footer={
        showTotal ? (
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">
              {formatPeso(total)}
            </span>
          </p>
        ) : undefined
      }
    />
  );
}
