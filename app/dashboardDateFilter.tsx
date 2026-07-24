"use client";

import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { storeDateFromKey, storeDayKey } from "@/lib/format";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Shifts a "YYYY-MM-DD" store-day key by N calendar days. Manila has no
    DST, so a flat 24h step never lands on the wrong day. */
function shiftDateKey(dateKey: string, days: number): string {
  return storeDayKey(new Date(storeDateFromKey(dateKey).getTime() + days * ONE_DAY_MS));
}

/**
 * The dashboard used to be hardcoded to "today" with no way to look back —
 * this replaces that with an explicit day picker, so profit and the
 * transaction list both reload for whichever day is picked. Deliberately a
 * single date rather than a from/to range (see TransactionFilters, used on
 * Vault and Statistics for that) — the dashboard is a day-at-a-time view,
 * not a summary-over-a-range one; ranges live on Statistics.
 */
export default function DashboardDateFilter({ dateKey }: { dateKey: string }) {
  const router = useRouter();
  const today = storeDayKey(new Date());
  const isToday = dateKey === today;

  function go(next: string) {
    // Today has no query param at all — keeps the common case bookmarkable
    // at a clean "/" instead of always carrying today's own date around.
    router.push(next === today ? "/" : `/?date=${next}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="dashboard-date" className="sr-only">
        Date
      </Label>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Previous day"
        onClick={() => go(shiftDateKey(dateKey, -1))}
      >
        <ChevronLeftIcon />
      </Button>
      <Input
        id="dashboard-date"
        type="date"
        max={today}
        value={dateKey}
        onChange={(event) => {
          if (event.target.value) go(event.target.value);
        }}
        className="w-auto"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Next day"
        disabled={isToday}
        onClick={() => go(shiftDateKey(dateKey, 1))}
      >
        <ChevronRightIcon />
      </Button>
      {!isToday ? (
        <Button type="button" variant="outline" size="sm" onClick={() => go(today)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}
