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
});

export function formatDateTime(value: string): string {
  return dateTime.format(new Date(value));
}
