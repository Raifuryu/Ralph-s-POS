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

/**
 * Absolute UTC instants bounding a store-timezone calendar day — ready to
 * feed straight into a `.gte()`/`.lte()` query. Manila has no DST, so the
 * offset is a fixed UTC+8 year-round, unlike storeDateFromKey's noon anchor
 * (safe for display, not for exact range boundaries).
 */
export function storeDayRange(dateKey: string): { fromTs: string; toTs: string } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const fromTs = new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0)).toISOString();
  const toTs = new Date(
    Date.UTC(year, month - 1, day + 1, -8, 0, 0, 0) - 1
  ).toISOString();
  return { fromTs, toTs };
}
