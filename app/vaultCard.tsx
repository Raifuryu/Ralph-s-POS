import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import SetBaselineFundTargetSheet from "./setBaselineFundTargetSheet";

export default function VaultCard({
  title = "Money on hand",
  balances,
  baselineFundTarget,
  compact = false,
  className,
}: {
  /** The Sales dashboard shows this same Cash/GCash/Maya card as "Baseline
      Fund" instead — everywhere else (Vault page, Vault Snapshot sheet)
      keeps the default. */
  title?: string;
  balances: Map<MoneyAccount, number>;
  /** The Cash+GCash+Maya total the owner wants maintained (see
      setBaselineFundTarget's own comment in
      lib/mysql/operations/storeSettings.ts) — `undefined` hides both the
      gap note and the "Set target" trigger entirely (only the Sales
      dashboard passes this today); `null` shows the trigger but no target
      is set yet, so no gap note either. */
  baselineFundTarget?: number | null;
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
  const deficit =
    baselineFundTarget !== undefined && baselineFundTarget !== null
      ? total - baselineFundTarget
      : undefined;

  return (
    <MoneyBreakdownCard
      title={title}
      total={total}
      headlineNote={
        deficit !== undefined ? (
          deficit < 0 ? (
            <span className="text-destructive">
              {formatPeso(Math.abs(deficit))} short
            </span>
          ) : deficit > 0 ? (
            `${formatPeso(deficit)} over`
          ) : (
            "on target"
          )
        ) : undefined
      }
      rows={rows}
      href="/vault"
      linkLabel="Vault →"
      headerExtra={
        baselineFundTarget !== undefined ? (
          <SetBaselineFundTargetSheet currentTarget={baselineFundTarget} />
        ) : undefined
      }
      compact={compact}
      className={className}
    />
  );
}
