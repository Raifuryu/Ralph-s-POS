"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiSelectOption = { key: string; name: string };

/** Trigger label — the facet name ("Category") when nothing's picked, the
    one name when exactly one is, otherwise a plain count. Listing every
    name once 3+ are picked would make the trigger grow unpredictably
    wide. */
function triggerLabel(
  label: string,
  pluralLabel: string,
  options: MultiSelectOption[],
  active: Set<string>
): string {
  if (active.size === 0) return label;
  if (active.size === 1) {
    const only = options.find((option) => active.has(option.key));
    return only?.name ?? label;
  }
  return `${active.size} ${pluralLabel}`;
}

/**
 * One dropdown trigger + checklist popover for picking several of something
 * at once — reads as a single "select" control (closed state shows what's
 * picked, opening it reveals a checklist) instead of a scatter of
 * separately-tappable pills. Stays open while checking multiple boxes
 * (Popover only dismisses on an outside tap/Escape, unlike a Menu which
 * closes per item by default). Generalized out of Inventory's own
 * CategoryFilterDropdown so Statistics' Category/Product filters (and any
 * future multi-select facet) can reuse the exact same interaction instead
 * of rederiving it.
 */
export default function MultiSelectDropdown({
  label,
  pluralLabel = `${label.toLowerCase()}s`,
  options,
  active,
  onChange,
}: {
  label: string;
  /** Trigger text once 2+ are selected, e.g. "3 categories". Defaults to a
      lowercased, pluralized `label`. */
  pluralLabel?: string;
  options: MultiSelectOption[];
  active: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const filtered =
    needle === ""
      ? options
      : options.filter((option) => option.name.toLowerCase().includes(needle));

  function toggle(key: string) {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  return (
    <Popover
      onOpenChange={(open) => {
        // Only worth searching once there's enough options to scroll
        // through — reset on close so reopening doesn't show a stale
        // filter from last time.
        if (!open) setSearch("");
      }}
    >
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "justify-between gap-2"
        )}
      >
        <span className={cn(active.size === 0 && "text-muted-foreground")}>
          {triggerLabel(label, pluralLabel, options, active)}
        </span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent>
        {options.length > 6 ? (
          <Input
            type="search"
            aria-label={`Search ${pluralLabel}`}
            placeholder={`Search ${pluralLabel}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            className="mb-1 h-8"
          />
        ) : null}
        {needle === "" && active.size > 0 ? (
          <>
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              Clear selection
            </button>
            <div className="my-1 border-t" />
          </>
        ) : null}
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">
            No {pluralLabel} match “{search.trim()}”.
          </p>
        ) : (
          <div className="flex max-h-72 flex-col overflow-y-auto">
            {filtered.map((option) => (
              <label
                key={option.key}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
              >
                <Checkbox
                  checked={active.has(option.key)}
                  onCheckedChange={() => toggle(option.key)}
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
