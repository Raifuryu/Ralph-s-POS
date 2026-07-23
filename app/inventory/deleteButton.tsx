"use client";

import { useActionState } from "react";
import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteProduct, type InventoryState } from "./actions";

const initialState: InventoryState = { error: null };

export default function DeleteButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, formAction, isPending] = useActionState(
    deleteProduct,
    initialState
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!confirm(`Delete "${name}"? Past sales keep their own record.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        aria-label={isPending ? `Deleting ${name}` : `Delete ${name}`}
        className="text-destructive hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
