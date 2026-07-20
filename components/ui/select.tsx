import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Styled NATIVE select, deliberately not a custom dropdown: phones open their
 * built-in picker, which beats any popover for one-handed use at the counter.
 * Styling mirrors components/ui/input.tsx.
 */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  );
}

export { Select };
