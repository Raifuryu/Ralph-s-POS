"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type FilterValues = {
  q: string;
  from: string;
  to: string;
};

/** Local YYYY-MM-DD — not toISOString(), which would shift the day in UTC+8. */
function localDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

export default function TransactionFilters({
  initial,
  basePath = "/",
  searchLabel = "Item name",
  searchPlaceholder = "e.g. Kropek",
  showDateRange = true,
  showSearch = true,
}: {
  initial: FilterValues;
  /** Where Apply/Clear navigate to — lets this filter drive any list page. */
  basePath?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** Set false on pages that are always scoped to a single fixed window
      (e.g. the daily dashboard) — hides the From/To pickers and presets,
      leaving just the search field. */
  showDateRange?: boolean;
  /** Set false on pages where item-name search doesn't apply (e.g.
      aggregate/statistics views) — hides the search field, leaving just the
      date range. */
  showSearch?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const activeCount = [
    showSearch && initial.q,
    showDateRange && initial.from,
    showDateRange && initial.to,
  ].filter(Boolean).length;

  function apply(next?: Partial<FilterValues>) {
    const values = { q, from, to, ...next };
    const params = new URLSearchParams();

    if (values.q.trim()) params.set("q", values.q.trim());

    // Send both the plain date (to repopulate the inputs) and the absolute
    // instant (for the query). The instant is derived from the browser's
    // timezone, so "today" means the cashier's today, not UTC's.
    if (values.from) {
      params.set("from", values.from);
      params.set("from_ts", new Date(`${values.from}T00:00:00`).toISOString());
    }
    if (values.to) {
      params.set("to", values.to);
      params.set("to_ts", new Date(`${values.to}T23:59:59.999`).toISOString());
    }

    router.push(params.size ? `${basePath}?${params}` : basePath);
  }

  function preset(fromDate: string) {
    const today = localDate(new Date());
    setFrom(fromDate);
    setTo(today);
    apply({ from: fromDate, to: today });
  }

  function clear() {
    setQ("");
    setFrom("");
    setTo("");
    router.push(basePath);
  }

  return (
    <Accordion defaultValue={activeCount > 0 ? ["filters"] : []}>
      <AccordionItem value="filters">
        <AccordionTrigger>
          Filters
          {activeCount > 0 ? (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </AccordionTrigger>

        <AccordionContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
            className="flex flex-col gap-4"
          >
            {showSearch ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="q" className="text-xs">
                  {searchLabel}
                </Label>
                <Input
                  id="q"
                  name="q"
                  value={q}
                  placeholder={searchPlaceholder}
                  onChange={(event) => setQ(event.target.value)}
                />
              </div>
            ) : null}

            {showDateRange ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="from" className="text-xs">
                      From
                    </Label>
                    <Input
                      id="from"
                      name="from"
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(event) => setFrom(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="to" className="text-xs">
                      To
                    </Label>
                    <Input
                      id="to"
                      name="to"
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(event) => setTo(event.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => preset(localDate(new Date()))}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => preset(daysAgo(6))}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => preset(daysAgo(29))}
                  >
                    Last 30 days
                  </Button>
                </div>
              </>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Apply
              </Button>
              {activeCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clear}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </form>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
