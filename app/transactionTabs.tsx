"use client";

import { useMemo } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  TRANSACTION_FILTERS,
  TRANSACTION_FILTER_LABELS,
  type TransactionWithItems,
} from "@/lib/types";
import TransactionTable from "./transactionTable";

export default function TransactionTabs({
  transactions,
}: {
  transactions: TransactionWithItems[];
}) {
  const byFilter = useMemo(
    () =>
      Object.fromEntries(
        TRANSACTION_FILTERS.map((filter) => [
          filter,
          filter === "all"
            ? transactions
            : transactions.filter((t) => t.payment_method === filter),
        ])
      ) as Record<(typeof TRANSACTION_FILTERS)[number], TransactionWithItems[]>,
    [transactions]
  );

  return (
    <Tabs defaultValue="all" className="w-full min-w-0">
      <TabsList className="w-full sm:w-fit">
        {TRANSACTION_FILTERS.map((filter) => (
          <TabsTrigger key={filter} value={filter}>
            {TRANSACTION_FILTER_LABELS[filter]}
          </TabsTrigger>
        ))}
      </TabsList>

      {TRANSACTION_FILTERS.map((filter) => (
        <TabsContent key={filter} value={filter} className="min-w-0">
          <TransactionTable transactions={byFilter[filter]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
