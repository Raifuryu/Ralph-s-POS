"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { shiftDateKey, storeDayKey } from "@/lib/format";

export type FilterValues = {
  q: string;
  from: string;
  to: string;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Store-timezone "N days ago", as a "YYYY-MM-DD" key — same storeDayKey
    helper DashboardDateFilter already uses, not the browser's own clock/
    timezone (date.getTimezoneOffset(), as this used to do). Those can
    disagree with the store's actual Asia/Manila day, silently shifting
    which transactions the "Today"/"Last N days" presets below pull in
    relative to what the dashboard shows for the same calendar day. Manila
    has no DST, so a flat 24h step per day never lands on the wrong date. */
function daysAgo(n: number): string {
  return storeDayKey(new Date(Date.now() - n * ONE_DAY_MS));
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
  const today = storeDayKey(new Date());

  const activeCount = [
    showSearch && initial.q,
    showDateRange && initial.from,
    showDateRange && initial.to,
  ].filter(Boolean).length;

  function apply(next?: Partial<FilterValues>) {
    const values = { q, from, to, ...next };
    const params = new URLSearchParams();

    if (values.q.trim()) params.set("q", values.q.trim());

    // Send both the plain date (to repopulate the inputs) and the query
    // bound. The bound is a naive "YYYY-MM-DD HH:MM:SS" local literal, not a
    // UTC instant — every pooled MariaDB connection pins its session
    // time_zone to '+08:00' (see lib/mysql/pool.ts), so a real UTC instant
    // string would get silently re-interpreted as if it were already store
    // wall-clock time, shifting the whole range 8 hours (see the comment on
    // storeDayRange in lib/format.ts, which hit the identical bug). This
    // also sidesteps ever depending on the browser's own timezone — `from`/
    // `to` are plain calendar dates from the picker, meant as the STORE's
    // day regardless of what device the cashier is using.
    if (values.from) {
      params.set("from", values.from);
      params.set("from_ts", `${values.from} 00:00:00`);
    }
    if (values.to) {
      params.set("to", values.to);
      params.set("to_ts", `${values.to} 23:59:59`);
    }

    router.push(params.size ? `${basePath}?${params}` : basePath);
  }

  function preset(fromDate: string) {
    setFrom(fromDate);
    setTo(today);
    apply({ from: fromDate, to: today });
  }

  // Nav arrows shift whichever field they're attached to by one day and
  // apply immediately, same "button click = instant action" behavior as the
  // preset buttons above (typing/picking in the raw input still waits on
  // Apply). Clamped against the other bound so From can never end up after
  // To (or vice versa) — same ordering the manual pickers' min/max already
  // enforce, just also covering the button path.
  function shiftFrom(days: number) {
    const next = shiftDateKey(from || today, days);
    const clamped = to && next > to ? to : next;
    setFrom(clamped);
    apply({ from: clamped });
  }

  function shiftTo(days: number) {
    const next = shiftDateKey(to || today, days);
    const clamped = from && next < from ? from : next;
    setTo(clamped);
    apply({ to: clamped });
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
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="From: previous day"
                        onClick={() => shiftFrom(-1)}
                      >
                        <ChevronLeftIcon />
                      </Button>
                      <Input
                        id="from"
                        name="from"
                        type="date"
                        value={from}
                        max={to || undefined}
                        onChange={(event) => setFrom(event.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="From: next day"
                        onClick={() => shiftFrom(1)}
                      >
                        <ChevronRightIcon />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="to" className="text-xs">
                      To
                    </Label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="To: previous day"
                        onClick={() => shiftTo(-1)}
                      >
                        <ChevronLeftIcon />
                      </Button>
                      <Input
                        id="to"
                        name="to"
                        type="date"
                        value={to}
                        min={from || undefined}
                        onChange={(event) => setTo(event.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="To: next day"
                        disabled={(to || today) >= today}
                        onClick={() => shiftTo(1)}
                      >
                        <ChevronRightIcon />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => preset(today)}
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
