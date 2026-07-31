"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  SALES_FILTERS,
  SALES_FILTER_LABELS,
  salesEntryCategory,
  type SalesEntry,
  type SalesFilter,
} from "@/lib/types";
import TransactionTable from "./transactionTable";

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

  const byFilter = useMemo(
    () =>
      Object.fromEntries(
        SALES_FILTERS.map((filter) => [
          filter,
          filter === "all"
            ? entries
            : entries.filter((entry) => salesEntryCategory(entry) === filter),
        ])
      ) as Record<(typeof SALES_FILTERS)[number], SalesEntry[]>,
    [entries]
  );

  function handleTabChange(value: string) {
    const params = new URLSearchParams(window.location.search);
    if (value === "all") params.delete("tab");
    else params.set("tab", value);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  return (
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
          <TransactionTable entries={byFilter[filter]} dateKey={dateKey} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
