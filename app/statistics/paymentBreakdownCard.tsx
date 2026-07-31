import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
import { formatPeso } from "@/lib/format";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

/**
 * Revenue by payment method for the selected range — distinct from
 * app/vaultCard.tsx, which shows current *balance* rather than period
 * revenue. Same validated ACCOUNT_COLORS mapping, same meaning as
 * everywhere else in the app.
 */
export default function PaymentBreakdownCard({
  title,
  subtitle,
  revenue,
  personalTake,
  className,
}: {
  title: string;
  subtitle?: string;
  revenue: Map<MoneyAccount, number>;
  /** Value of stock taken out without a sale — shown as its own footer
      line, never folded into the rows/total/bar above, since a personal
      take has no payment method to attribute it to (see checkoutForm.tsx:
      no payment method, no tender, no income posted for one). Omitted (or
      0) hides the line. */
  personalTake?: number;
  className?: string;
}) {
  const rows = ACCOUNT_ORDER.map((account) => ({
    key: account,
    label: MONEY_ACCOUNT_LABELS[account],
    value: revenue.get(account) ?? 0,
    color: ACCOUNT_COLORS[account],
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <MoneyBreakdownCard
      title={title}
      subtitle={subtitle}
      total={total}
      rows={rows}
      footer={
        (personalTake ?? 0) > 0 ? (
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Personal take</span>
            <span className="tabular-nums text-muted-foreground">
              {formatPeso(personalTake ?? 0)}
            </span>
          </p>
        ) : undefined
      }
      className={className}
    />
  );
}
