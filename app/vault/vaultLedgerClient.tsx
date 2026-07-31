"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { VAULT_LEDGER_PAGE_SIZE, type VaultLedgerFilters } from "@/lib/vault/ledgerFilters";
import { loadMoreVaultEntries } from "./actions";
import Ledger, { type LedgerEntry } from "./ledger";

/**
 * Client-side "load more" wrapper around the read-only Ledger table — mounted
 * fresh (via a `key` on the current filters, set by the caller) whenever the
 * search/date filter changes, so switching filters naturally starts back at
 * the first batch instead of carrying over a stale scroll position.
 */
export default function VaultLedgerClient({
  initialEntries,
  initialTotal,
  filters,
  filtered,
}: {
  initialEntries: LedgerEntry[];
  initialTotal: number;
  filters: VaultLedgerFilters;
  filtered: boolean;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    startTransition(async () => {
      const next = await loadMoreVaultEntries(filters, entries.length);
      setEntries((prev) => [...prev, ...next.entries]);
      setTotal(next.total);
    });
  }

  return (
    <>
      <Ledger entries={entries} filtered={filtered} />
      {entries.length < total ? (
        <Button
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={handleLoadMore}
        >
          {isPending
            ? "Loading…"
            : `Show ${Math.min(VAULT_LEDGER_PAGE_SIZE, total - entries.length)} more (${total - entries.length} left)`}
        </Button>
      ) : null}
    </>
  );
}
