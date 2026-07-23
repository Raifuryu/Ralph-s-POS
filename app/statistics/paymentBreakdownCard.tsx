import { MoneyBreakdownCard } from "@/components/moneyBreakdownCard";
import { ACCOUNT_COLORS, ACCOUNT_ORDER } from "@/lib/accountColors";
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
  className,
}: {
  title: string;
  subtitle?: string;
  revenue: Map<MoneyAccount, number>;
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
      className={className}
    />
  );
}
