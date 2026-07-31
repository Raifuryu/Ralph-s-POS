"use client";

import { ChevronDownIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CategoryOption = { key: string; name: string; count: number };

/** Trigger label — "Category" when nothing's picked, the one name when
    exactly one is, otherwise a plain count. Listing every name once 3+ are
    picked would make the trigger grow unpredictably wide. */
function triggerLabel(options: CategoryOption[], active: Set<string>): string {
  if (active.size === 0) return "Category";
  if (active.size === 1) {
    const only = options.find((option) => active.has(option.key));
    return only?.name ?? "Category";
  }
  return `${active.size} categories`;
}

/**
 * One dropdown trigger + checklist popover, replacing what used to be a row
 * of toggle chips — reads as a single "select" control (closed state shows
 * what's picked, opening it reveals a checklist) instead of a scatter of
 * separately-tappable pills, while still allowing more than one category at
 * once. Stays open while checking multiple boxes (Popover only dismisses on
 * an outside tap/Escape, unlike a Menu which closes per item by default).
 */
export default function CategoryFilterDropdown({
  options,
  totalCount,
  active,
  onChange,
}: {
  options: CategoryOption[];
  totalCount: number;
  active: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggle(key: string) {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "justify-between gap-2"
        )}
      >
        <span className={cn(active.size === 0 && "text-muted-foreground")}>
          {triggerLabel(options, active)}
        </span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent>
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
            active.size === 0 && "font-medium"
          )}
        >
          <span>All items</span>
          <span className="text-xs text-muted-foreground">{totalCount}</span>
        </button>
        <div className="my-1 border-t" />
        <div className="flex max-h-72 flex-col overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <Checkbox
                checked={active.has(option.key)}
                onCheckedChange={() => toggle(option.key)}
              />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {option.count}
              </span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
