"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { deleteService, type ServiceFormState } from "./serviceActions";

const initialState: ServiceFormState = { error: null };

export default function ServiceDeleteButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, formAction, isPending] = useActionState(
    deleteService,
    initialState
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!confirm(`Delete "${name}"? Recorded services keep their history.`)) {
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
