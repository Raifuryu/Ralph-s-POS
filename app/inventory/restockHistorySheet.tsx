"use client";

import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/emptyState";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatDateTime, formatPeso } from "@/lib/format";

export type RestockHistoryEntry = {
  id: string;
  quantity: number;
  cost: number;
  note: string | null;
  created_at: string;
  /** Revenue from this product's sales since this batch was bought. */
  recovered: number;
};

/**
 * Per-product restock history as a bottom sheet, URL-driven (?history=<id>)
 * like ProductSheet. "Recovered" tracks cost-recovery on what the owner
 * spent buying stock, not a supplier balance — there's nobody being paid.
 */
export default function RestockHistorySheet({
  open,
  productName,
  entries,
}: {
  open: boolean;
  productName?: string;
  entries: RestockHistoryEntry[];
}) {
  const router = useRouter();

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) router.push("/inventory", { scroll: false });
      }}
      showSwipeHandle
    >
      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>
            {productName ? `${productName} — restock history` : "Restock history"}
          </DrawerTitle>
          <DrawerDescription>
            Recovered is this item&apos;s sales since each batch was bought.
            Older batches also get credit for sales after a later restock —
            there&apos;s no per-unit link back to which batch a sale came
            from, so treat this as a rough guide, not exact accounting.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {entries.length === 0 ? (
            <EmptyState title="No restocks recorded yet." />
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.map((entry) => {
                const net = entry.recovered - entry.cost;
                return (
                  <li key={entry.id} className="rounded-lg border p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        {entry.quantity} pc{entry.quantity === 1 ? "" : "s"} ·{" "}
                        {formatPeso(entry.cost)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.created_at)}
                      </p>
                    </div>
                    {entry.note ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.note}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm">
                      <span
                        className={
                          net >= 0
                            ? "font-medium text-success"
                            : "font-medium"
                        }
                      >
                        {formatPeso(entry.recovered)} recovered
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        {net >= 0
                          ? `· +${formatPeso(net)} ahead`
                          : `· ${formatPeso(-net)} short of cost`}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
