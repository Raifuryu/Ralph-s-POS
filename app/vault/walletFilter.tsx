"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { FilterChip } from "@/components/filterChip";
import { ACCOUNT_ORDER } from "@/lib/accountColors";
import {
  MONEY_ACCOUNT_LABELS,
  PROFIT_FUNDS,
  PROFIT_FUND_LABELS,
  type MoneyAccount,
  type ProfitFund,
} from "@/lib/types";

/**
 * Narrows the ledger below to just the selected account(s)/fund(s)/
 * wallet(s) — Cash/GCash/Maya, Profit/For Restock, and every active
 * owner-created wallet, each independently toggleable (unlike every other
 * FilterChip row in this app, which is single-active-at-a-time — see
 * FilterChip's own comment) so e.g. "GCash + Profit + Delivery fund" is one
 * tap each away. Empty selection means no filter, same "off means
 * everything" convention SeriesLegend's own multi-toggle follows. The three
 * kinds write to separate URL params (`account`/`fund`/`wallet` — this
 * component's own name now literally matches the last one) but combine as
 * one OR in the query (see VaultLedgerFilters' own comment) — an entry is
 * on exactly one of them, never more than one. Applies immediately (no
 * separate Apply button), preserving whatever else is already in the URL
 * (search/date) via window.location.search — same merge TransactionTabs'
 * own tab switch already does — rather than a static preserveParams prop,
 * so this doesn't need vault/page.tsx to hand it one.
 *
 * Deliberately its own component, not folded into TransactionFilters
 * (shared by Sales/Statistics/Vault, none of which else have an account/
 * fund/wallet concept) — Vault-only.
 */
export default function WalletFilter({
  initialAccounts,
  initialFunds,
  initialWalletIds,
  wallets,
  basePath,
}: {
  initialAccounts: MoneyAccount[];
  initialFunds: ProfitFund[];
  initialWalletIds: string[];
  /** Active wallets only — an archived one drops out of this picker, same
      as every other wallet picker in the app (a URL that already names one
      keeps working as a filter, it just isn't offered here as a fresh
      chip). */
  wallets: { id: string; name: string }[];
  basePath: string;
}) {
  const router = useRouter();
  const [selectedAccounts, setSelectedAccounts] = useState(new Set(initialAccounts));
  const [selectedFunds, setSelectedFunds] = useState(new Set(initialFunds));
  const [selectedWalletIds, setSelectedWalletIds] = useState(new Set(initialWalletIds));

  function apply(
    nextAccounts: Set<MoneyAccount>,
    nextFunds: Set<ProfitFund>,
    nextWalletIds: Set<string>
  ) {
    const params = new URLSearchParams(window.location.search);
    if (nextAccounts.size > 0) params.set("account", [...nextAccounts].join(","));
    else params.delete("account");
    if (nextFunds.size > 0) params.set("fund", [...nextFunds].join(","));
    else params.delete("fund");
    if (nextWalletIds.size > 0) params.set("wallet", [...nextWalletIds].join(","));
    else params.delete("wallet");
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  }

  function toggleAccount(account: MoneyAccount) {
    const next = new Set(selectedAccounts);
    if (next.has(account)) next.delete(account);
    else next.add(account);
    setSelectedAccounts(next);
    apply(next, selectedFunds, selectedWalletIds);
  }

  function toggleFund(fund: ProfitFund) {
    const next = new Set(selectedFunds);
    if (next.has(fund)) next.delete(fund);
    else next.add(fund);
    setSelectedFunds(next);
    apply(selectedAccounts, next, selectedWalletIds);
  }

  function toggleWallet(walletId: string) {
    const next = new Set(selectedWalletIds);
    if (next.has(walletId)) next.delete(walletId);
    else next.add(walletId);
    setSelectedWalletIds(next);
    apply(selectedAccounts, selectedFunds, next);
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {ACCOUNT_ORDER.map((account) => (
        <FilterChip
          key={account}
          label={MONEY_ACCOUNT_LABELS[account]}
          active={selectedAccounts.has(account)}
          onClick={() => toggleAccount(account)}
        />
      ))}
      {PROFIT_FUNDS.map((fund) => (
        <FilterChip
          key={fund}
          label={PROFIT_FUND_LABELS[fund]}
          active={selectedFunds.has(fund)}
          onClick={() => toggleFund(fund)}
        />
      ))}
      {wallets.map((wallet) => (
        <FilterChip
          key={wallet.id}
          label={wallet.name}
          active={selectedWalletIds.has(wallet.id)}
          onClick={() => toggleWallet(wallet.id)}
        />
      ))}
    </div>
  );
}
