import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

export default function VaultCard({
  balances,
  compact = false,
  className,
}: {
  balances: Map<MoneyAccount, number>;
  compact?: boolean;
  className?: string;
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
    />
  );
}
