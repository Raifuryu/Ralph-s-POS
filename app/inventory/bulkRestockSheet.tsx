"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { Category, MoneyAccount, Product, ProfitFund } from "@/lib/types";
import BulkRestockForm from "./bulkRestockForm";

/**
 * Log a whole supplier receipt at once — a draft cart, URL-driven (?bulk)
 * like ProductSheet, nothing saved until submitted.
 */
export default function BulkRestockSheet({
  open,
  products,
  categories,
  vaultBalances,
  fundBalances,
  wallets,
}: {
  open: boolean;
  products: Product[];
  categories: Category[];
  /** Current Cash/GCash/Maya and Profit/For Restock balances — shown as
      hints next to the form's own optional "paid with" split, so a cashier
      can see what's actually available before typing an amount. */
  vaultBalances: Map<MoneyAccount, number>;
  fundBalances: Map<ProfitFund, number>;
  /** Active wallets only, with their current balance — same "hint" purpose
      as vaultBalances/fundBalances above. */
  wallets: { id: string; name: string; balance: number }[];
}) {
  const router = useRouter();

  // Local, not driven purely by the `open` prop — a swipe-to-close needs to
  // animate away instantly. If it waited on `open` to flip (it's URL-driven,
  // via the router.push below), the sheet would sit open until that
  // navigation's server round trip finished, which feels laggy next to
  // every other Drawer in the app that closes off local state alone.
  // Reset-during-render (React's "adjust state during render" pattern):
  // only re-syncs from the prop when it actually changes (a fresh deep
  // link), never stomping an in-progress swipe.
  const [openState, setOpenState] = useState({ prop: open, value: open });
  if (openState.prop !== open) {
    setOpenState({ prop: open, value: open });
  }
  const drawerOpen = openState.value;

  return (
    <Drawer
      open={drawerOpen}
      onOpenChange={(next) => {
        setOpenState({ prop: open, value: next });
        if (!next) router.push("/inventory", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Restock</DrawerTitle>
          <DrawerDescription>
            Add each item bought, its cost, and its selling price. Nothing is
            saved until you submit.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <BulkRestockForm
            products={products}
            categories={categories}
            vaultBalances={vaultBalances}
            fundBalances={fundBalances}
            wallets={wallets}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
