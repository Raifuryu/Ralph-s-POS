/**
 * The store's timezone, pinned explicitly. Server components render wherever
 * the server runs (UTC on Vercel) — without this, every displayed time would
 * silently shift by the host's offset.
 */
export const STORE_TIME_ZONE = "Asia/Manila";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

/** Formats a peso amount. Values arrive from Postgres `numeric` columns. */
export function formatPeso(value: number): string {
  return peso.format(value);
}

const dateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: STORE_TIME_ZONE,
});

export function formatDateTime(value: string): string {
  return dateTime.format(new Date(value));
}

const dateOnly = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: STORE_TIME_ZONE,
});

export function formatDate(value: string | Date): string {
  return dateOnly.format(new Date(value));
}

const shortDate = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: STORE_TIME_ZONE,
});

/** Compact "Jul 23" — for chart axis labels, where formatDate's full
    weekday+year is too wide to repeat across many bars. */
export function formatShortDate(value: string | Date): string {
  return shortDate.format(new Date(value));
}

const timeOnly = new Intl.DateTimeFormat("en-PH", {
  timeStyle: "short",
  timeZone: STORE_TIME_ZONE,
});

export function formatTime(value: string): string {
  return timeOnly.format(new Date(value));
}

// en-CA renders YYYY-MM-DD — a stable, sortable key for "same store-day".
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
});

/** Calendar-day key (store timezone) for grouping timestamps. */
export function storeDayKey(value: string | Date): string {
  return dayKeyFormat.format(new Date(value));
}

/** "Today" / "Yesterday" / formatted date, relative to the store's clock. */
export function friendlyDayLabel(value: string | Date): string {
  const key = storeDayKey(value);
  const now = Date.now();
  if (key === storeDayKey(new Date(now))) return "Today";
  if (key === storeDayKey(new Date(now - 24 * 60 * 60 * 1000))) {
    return "Yesterday";
  }
  return formatDate(value);
}

/**
 * Turns a "YYYY-MM-DD" filter value (a store calendar day, e.g. from the date
 * picker) into an absolute instant safe to format. Anchored at noon UTC+8
 * rather than parsed as local time — `new Date("2026-07-14T00:00:00")` is
 * parsed in the SERVER's local timezone, not the store's, so on a UTC host it
 * would land on the wrong calendar day when read back with storeDayKey/
 * formatDate. Noon Manila stays inside the same calendar day everywhere.
 */
export function storeDateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12 - 8, 0, 0));
}

/** "What window is this" phrasing for a date-range-filtered card/chart —
    Statistics and Vault both show this next to figures scoped by
    TransactionFilters' from/to. */
export function rangeSubtitle(from?: string, to?: string): string {
  if (from && to) {
    if (from === to) return friendlyDayLabel(storeDateFromKey(from));
    return `${formatDate(storeDateFromKey(from))} – ${formatDate(storeDateFromKey(to))}`;
  }
  if (from) return `Since ${formatDate(storeDateFromKey(from))}`;
  if (to) return `Until ${formatDate(storeDateFromKey(to))}`;
  return "All time";
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Shifts a "YYYY-MM-DD" store-day key by N calendar days — the "Previous
    day"/"Next day" arrows on DashboardDateFilter and TransactionFilters both
    use this. Manila has no DST, so a flat 24h step never lands on the wrong
    day. */
export function shiftDateKey(dateKey: string, days: number): string {
  return storeDayKey(new Date(storeDateFromKey(dateKey).getTime() + days * ONE_DAY_MS));
}

/**
 * Wall-clock bounds (store timezone) of a calendar day, as naive
 * "YYYY-MM-DD HH:MM:SS" literals ready to bind against a TIMESTAMP column.
 *
 * Deliberately NOT UTC instants (this function used to build them via
 * `Date.UTC(...).toISOString()`). mysql2 sends a plain JS string parameter
 * to MariaDB completely unmodified — no timezone conversion, the trailing
 * 'Z' means nothing there — and every pooled connection pins its SESSION
 * time_zone to '+08:00' (see lib/mysql/pool.ts). So a real UTC instant
 * string got silently re-interpreted by MariaDB as if it were already
 * Manila wall-clock time, shifting the whole window 8 hours off and making
 * "today" actually cover ~4pm yesterday through ~4pm today. Emitting naive
 * local literals directly sidesteps the mismatch entirely: MariaDB applies
 * the (correct) session offset itself. Manila has no DST, so this is exact
 * year-round.
 */
export function storeDayRange(dateKey: string): { fromTs: string; toTs: string } {
  return { fromTs: `${dateKey} 00:00:00`, toTs: `${dateKey} 23:59:59` };
}

// hourCycle: "h23" pins the output to 0–23 — plain hour12:false is a known
// footgun in some Intl implementations, which render midnight as "24".
const hourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  hour: "numeric",
  hourCycle: "h23",
});

/** Hour of day (0–23) in the store's timezone — for bucketing timestamps by
    time-of-day. Same Intl-with-explicit-timeZone approach as the rest of
    this file, not `Date#getHours()`, since that reads the SERVER's own
    timezone rather than the store's. */
export function storeHour(value: string | Date): number {
  return Number(hourFormat.format(new Date(value)));
}

/** "2 AM" / "2 PM" style label for an hour-of-day bucket (0–23). */
export function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour} ${period}`;
}

const weekdayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  weekday: "short",
});

/** Su, Mo, Tu, We, Th, Fr, Sa — Intl's weekday names, not a fixed lookup
    table, so they stay correct if the locale ever changes. Used as the
    bucket key for "which day of the week" analysis (ProductAnalysis),
    paired with WEEKDAY_ORDER below for a stable Sun-first display order. */
export function storeWeekday(value: string | Date): string {
  return weekdayFormat.format(new Date(value));
}

/** Sun-first order for weekday buckets — matches how every common calendar
    (and the date picker's own week layout) starts the week in this locale. */
export const WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
