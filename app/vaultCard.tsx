import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";

export default function VaultCard({
  balances,
  funds,
  compact = false,
  className,
}: {
  balances: Map<MoneyAccount, number>;
  /** Profit/For Restock fund balances — shown as their own footer lines
      below the Cash/GCash/Maya breakdown, never folded into `rows`/`total`/
      the proportion bar above. A fund is a purpose-based lens on the SAME
      money already counted in Cash/GCash/Maya (see mariadb/schema.sql's own
      comment on vault_entries.fund), not additional cash — mixing it into
      the additive rows would double the headline total. Display-only, by
      design: this card reads straight off vault_fund_balance same as
      everywhere else funds appear, nothing here writes anything back.
      Omit to hide the section entirely (only the Sales dashboard shows it
      today). */
  funds?: Map<ProfitFund, number>;
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
        funds ? (
          <div className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {PROFIT_FUND_LABELS.profit}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatPeso(funds.get("profit") ?? 0)}
              </span>
            </p>
            <p className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {PROFIT_FUND_LABELS.reinvest}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatPeso(funds.get("reinvest") ?? 0)}
              </span>
            </p>
          </div>
        ) : undefined
      }
    />
  );
}
