"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  MONEY_ACCOUNT_LABELS,
  PAYMENT_METHOD_LABELS,
  SALES_FILTERS,
  SALES_FILTER_LABELS,
  salesEntryCategory,
  type SalesEntry,
  type SalesFilter,
} from "@/lib/types";
import TransactionTable from "./transactionTable";

/** Every bit of text a cashier might search for on one entry — product
    names off a sale's line items, or a service's name/reference/
    description/wallet — plus the payment method/account and a void reason,
    so "gcash" or "cancelled" both work as search terms too. Joined into one
    lowercase string rather than checking each field separately against the
    needle, same flattening ItemsBrowser's search already does over name +
    description. */
function searchableText(entry: SalesEntry): string {
  const parts: (string | null | undefined)[] =
    entry.kind === "sale"
      ? [
          entry.data.is_personal_take
            ? "personal take"
            : PAYMENT_METHOD_LABELS[entry.data.payment_method!],
          entry.data.void_reason,
          ...entry.data.transaction_items.map((item) => item.product_name),
        ]
      : [
          entry.data.service_name,
          entry.data.reference,
          entry.data.description,
          MONEY_ACCOUNT_LABELS[entry.data.payment_account],
          entry.data.wallet ? MONEY_ACCOUNT_LABELS[entry.data.wallet] : null,
          entry.data.void_reason,
        ];
  return parts.filter((part): part is string => Boolean(part)).join(" ").toLowerCase();
}

export default function TransactionTabs({
  entries,
  activeTab,
  dateKey,
}: {
  entries: SalesEntry[];
  /** Selected filter, mirrored in the URL via ?tab= so it survives page
      navigation. This used to be plain uncontrolled Tabs state
      (defaultValue="all") — Prev/Next fully re-renders this component from
      the server, which silently reset the selection back to "All" every
      time a cashier paged through a busy day while looking at one category. */
  activeTab: SalesFilter;
  /** Picked day, "YYYY-MM-DD" — threaded down to TransactionTable so its
      "load more" position resets when the cashier switches days instead of
      staying stuck mid-list from whatever day was viewed previously. */
  dateKey: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  // Client-side only — the whole day's entries are already in memory (see
  // app/page.tsx), so there's no server round trip to debounce and every
  // keystroke can filter instantly, same as ItemsBrowser's search.
  const needle = search.trim().toLowerCase();
  const searched = useMemo(
    () =>
      needle === ""
        ? entries
        : entries.filter((entry) => searchableText(entry).includes(needle)),
    [entries, needle]
  );

  const byFilter = useMemo(
    () =>
      Object.fromEntries(
        SALES_FILTERS.map((filter) => [
          filter,
          filter === "all"
            ? searched
            : searched.filter((entry) => salesEntryCategory(entry) === filter),
        ])
      ) as Record<(typeof SALES_FILTERS)[number], SalesEntry[]>,
    [searched]
  );

  function handleTabChange(value: string) {
    const params = new URLSearchParams(window.location.search);
    if (value === "all") params.delete("tab");
    else params.set("tab", value);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        type="search"
        aria-label="Search transactions"
        placeholder="Search item, service, payment method…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full min-w-0"
      >
        <TabsList className="w-full sm:w-fit">
          {SALES_FILTERS.map((filter) => (
            <TabsTrigger key={filter} value={filter}>
              {SALES_FILTER_LABELS[filter]}
            </TabsTrigger>
          ))}
        </TabsList>

        {SALES_FILTERS.map((filter) => (
          <TabsContent key={filter} value={filter} className="min-w-0">
            <TransactionTable
              entries={byFilter[filter]}
              resetKey={`${dateKey}|${needle}`}
              searchActive={needle !== ""}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
