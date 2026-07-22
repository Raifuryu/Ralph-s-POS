"use client";

import { useActionState } from "react";

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
        size="xs"
        disabled={isPending}
        aria-label={`Delete ${name}`}
        className="text-destructive hover:text-destructive"
      >
        {isPending ? "Deleting…" : "Delete"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
