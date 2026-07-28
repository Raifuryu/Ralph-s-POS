"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import type { MoneyAccount, Service } from "@/lib/types";
import ServiceLineEditor, { type ServiceDraft } from "./serviceLineEditor";

/**
 * Opens as its own full-height sheet, same reasoning as ItemPickerDrawer —
 * configuring a service (variant/amount/fee/payment method) needs its own
 * space, and nesting it here keeps it out of the way of the cart below
 * until there's actually something to show for it.
 */
export default function ServicePickerDrawer({
  services,
  balances,
  paymentMethod,
  drafts,
  onAdd
}: {
  services: Service[];
  balances: Map<MoneyAccount, number>;
  /** The sale's single payment method — passed straight through to
      ServiceLineEditor, which no longer picks its own. */
  paymentMethod: MoneyAccount;
  drafts: ServiceDraft[];
  onAdd: (draft: ServiceDraft) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        className={cn(
          buttonVariants({
            variant: drafts.length > 0 ? "outline" : "default"
          }),
          "w-full justify-between"
        )}
      >
        <span>Add service</span>
        {drafts.length > 0 ? (
          <Badge variant="primary">{drafts.length} added</Badge>
        ) : (
          <PlusIcon />
        )}
      </DrawerTrigger>

      <DrawerContent className="h-[100dvh]">
        <DrawerHeader>
          <DrawerTitle>Add service</DrawerTitle>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ServiceLineEditor
            services={services}
            balances={balances}
            paymentMethod={paymentMethod}
            drafts={drafts}
            onAdd={onAdd}
            onClose={() => setOpen(false)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
