import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";
import SetBaselineFundTargetSheet from "./setBaselineFundTargetSheet";

export type TransferOutItem = { key: string; label: string; amount: number };

export default function VaultCard({
  title = "Money on hand",
  balances,
  baselineFundTarget,
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
  /** The Cash+GCash+Maya total the owner wants maintained (see
      setBaselineFundTarget's own comment in
      lib/mysql/operations/storeSettings.ts) — `undefined` hides both the
      gap note and the "Set target" trigger entirely (only the Sales
      dashboard passes this today); `null` shows the trigger but no target
      is set yet, so no gap note either. */
  baselineFundTarget?: number | null;
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
