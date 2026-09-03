"use client";

import { useActionState, useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createWalletAction, type CreateWalletState } from "./actions";

const initialState: CreateWalletState = { error: null };

/**
 * The one way to add a 6th (7th, …) bucket beyond the fixed Cash/GCash/
 * Maya/Profit/For Restock — just a name; color is auto-assigned server-side
 * (createWallet's own walletColorFor) so this stays a one-field form.
 */
export default function AddWalletSheet() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    createWalletAction,
    initialState
  );

  useEffect(() => {
    if (!state.result) return;
    const timer = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(timer);
  }, [state.result]);

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "self-start"
        )}
      >
        <PlusIcon className="size-4" />
        Add wallet
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Add a wallet</DrawerTitle>
          <DrawerDescription>
            A new bucket alongside Profit/For Restock — transferable with
            Cash/GCash/Maya, and usable to pay for a restock, same as the
            other two.
          </DrawerDescription>
        </DrawerHeader>
        <form action={formAction} className="flex flex-col gap-3 p-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-wallet-name" className="text-xs">
              Name
            </Label>
            <Input
              id="new-wallet-name"
              name="name"
              required
              placeholder="e.g. Delivery fund"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.result ? (
            <p role="status" className="text-sm text-success">
              {state.result.name} added.
            </p>
          ) : null}
          <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
            <DrawerClose
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Cancel
            </DrawerClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Adding…" : "Add wallet"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
