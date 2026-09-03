"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { FilterChip } from "@/components/filterChip";
import { ACCOUNT_ORDER } from "@/lib/accountColors";
import { MONEY_ACCOUNT_LABELS, type MoneyAccount } from "@/lib/types";

/**
 * Narrows the ledger below to just the selected wallet(s) — Cash/GCash/Maya,
 * each independently toggleable (unlike every other FilterChip row in this
 * app, which is single-active-at-a-time — see FilterChip's own comment) so
 * e.g. "GCash + Maya" (everything except cashbox) is one tap each away.
 * Empty selection means no filter, same "off means everything" convention
 * SeriesLegend's own multi-toggle follows. Applies immediately (no separate
 * Apply button), preserving whatever else is already in the URL (search/
 * date) via window.location.search — same merge TransactionTabs' own tab
 * switch already does — rather than a static preserveParams prop, so this
 * doesn't need vault/page.tsx to hand it one.
 *
 * Deliberately its own component, not folded into TransactionFilters
 * (shared by Sales/Statistics/Vault, none of which else have a wallet
 * concept) — Vault-only.
 */
export default function WalletFilter({
  initial,
  basePath,
}: {
  initial: MoneyAccount[];
  basePath: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(new Set(initial));

  function toggle(account: MoneyAccount) {
    const next = new Set(selected);
    if (next.has(account)) next.delete(account);
    else next.add(account);
    setSelected(next);

    const params = new URLSearchParams(window.location.search);
    if (next.size > 0) params.set("wallet", [...next].join(","));
    else params.delete("wallet");
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {ACCOUNT_ORDER.map((account) => (
        <FilterChip
          key={account}
          label={MONEY_ACCOUNT_LABELS[account]}
          active={selected.has(account)}
          onClick={() => toggle(account)}
        />
      ))}
    </div>
  );
}
