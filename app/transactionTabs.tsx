"use client";

import { useMemo } from "react";

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
} from "@/lib/types";
import TransactionTable from "./transactionTable";

export default function TransactionTabs({
  entries,
}: {
  entries: SalesEntry[];
}) {
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

  return (
    <Tabs defaultValue="all" className="w-full min-w-0">
      <TabsList className="w-full sm:w-fit">
        {SALES_FILTERS.map((filter) => (
          <TabsTrigger key={filter} value={filter}>
            {SALES_FILTER_LABELS[filter]}
          </TabsTrigger>
        ))}
      </TabsList>

      {SALES_FILTERS.map((filter) => (
        <TabsContent key={filter} value={filter} className="min-w-0">
          <TransactionTable entries={byFilter[filter]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
