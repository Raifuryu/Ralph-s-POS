import * as React from "react";

import { cn } from "@/lib/utils";

/** Small pill label (categories, accounts, cart counts). */
function Badge({
  className,
  variant = "muted",
  ...props
}: React.ComponentProps<"span"> & { variant?: "muted" | "primary" }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        variant === "primary"
          ? "bg-primary font-medium text-primary-foreground"
          : "bg-muted text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
