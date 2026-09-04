"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { FilterChip } from "@/components/filterChip";
import { VAULT_ENTRY_TYPE_LABELS, type VaultEntryType } from "@/lib/types";
import { VAULT_LEDGER_FILTER_TYPES } from "@/lib/vault/ledgerFilters";

/**
 * Narrows the ledger below to just the selected entry type(s) — Cash in,
 * Cash out, Transfer, Adjustment, each independently toggleable (empty
 * selection means no filter, same convention as WalletFilter's own chips).
 * Writes to its own `type` URL param, ANDed with WalletFilter's account/
 * fund/wallet OR-group rather than folded into it (see
 * VaultLedgerFilters.types' own comment) — kept as a separate component
 * for that reason, even though it sits right below WalletFilter in the
 * page. Applies immediately, preserving whatever else is in the URL, same
 * "merge via window.location.search" approach WalletFilter uses.
 */
export default function VaultTypeFilter({
  initialTypes,
  basePath,
}: {
  initialTypes: VaultEntryType[];
  basePath: string;
}) {
  const router = useRouter();
  const [selectedTypes, setSelectedTypes] = useState(new Set(initialTypes));

  function toggleType(type: VaultEntryType) {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setSelectedTypes(next);

    const params = new URLSearchParams(window.location.search);
    if (next.size > 0) params.set("type", [...next].join(","));
    else params.delete("type");
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {VAULT_LEDGER_FILTER_TYPES.map((type) => (
        <FilterChip
          key={type}
          label={VAULT_ENTRY_TYPE_LABELS[type]}
          active={selectedTypes.has(type)}
          onClick={() => toggleType(type)}
        />
      ))}
    </div>
  );
}
