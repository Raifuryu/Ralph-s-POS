"use client";

import { useActionState, useEffect, useState } from "react";
import { SettingsIcon } from "lucide-react";

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
import {
  setBaselineFundTargetAction,
  type SetBaselineFundTargetState,
} from "./baselineFundActions";

const initialState: SetBaselineFundTargetState = { error: null, saved: false };

/**
 * The trigger + form for the Baseline Fund's maintained target — a single
 * combined Cash+GCash+Maya figure the owner wants kept on hand (see
 * setBaselineFundTarget's own comment in
 * lib/mysql/operations/storeSettings.ts). Lives in VaultCard's own
 * `headerExtra` slot, right beside the "Vault →" link. Leaving the field
 * blank clears the target (hides the gap note entirely).
 */
export default function SetBaselineFundTargetSheet({
  currentTarget,
}: {
  currentTarget: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    setBaselineFundTargetAction,
    initialState
  );

  useEffect(() => {
    if (!state.saved) return;
    const timer = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(timer);
  }, [state.saved]);

  return (
    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
      <DrawerTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "xs" }),
          "text-muted-foreground"
        )}
        aria-label="Set baseline fund target"
      >
        <SettingsIcon className="size-3.5" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Set Baseline Fund target</DrawerTitle>
          <DrawerDescription>
            The Cash+GCash+Maya total you want kept on hand. The card shows
            how far the live total is from this, in red once it falls short.
            Leave blank to stop tracking it.
          </DrawerDescription>
        </DrawerHeader>
        <form action={formAction} className="flex flex-col gap-3 p-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseline-fund-target" className="text-xs">
              Target amount
            </Label>
            <Input
              id="baseline-fund-target"
              name="target"
              inputMode="decimal"
              placeholder="e.g. 10000"
              defaultValue={currentTarget ?? ""}
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.saved ? (
            <p role="status" className="text-sm text-success">
              Saved.
            </p>
          ) : null}
          <DrawerFooter className="flex-row items-center justify-end gap-2 border-t p-0 pt-4">
            <DrawerClose
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Cancel
            </DrawerClose>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
