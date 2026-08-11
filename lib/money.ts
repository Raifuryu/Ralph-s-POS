/**
 * Shared money/quantity input parsing for server actions.
 *
 * Every money field in the app follows the same rules: numeric, at most two
 * decimal places (Postgres numeric(_,2) would otherwise silently round), and
 * non-negative. Variants differ only in whether blank is allowed and whether
 * zero is.
 */

export type ParsedMoney = number | null | "bad";

// At most 2 decimal digits, checked against the raw STRING rather than the
// parsed float. The old check compared Math.round(parsed * 100) against
// parsed * 100 directly — but IEEE754 doubles don't hold most decimal
// fractions exactly (19.1 * 100 is 1910.0000000000002, not 1910), so that
// comparison failed for roughly 1 in 7 perfectly valid two-decimal amounts
// (19.10, 4.40, 8.20, ...), rejecting them as "bad" even though the
// cashier typed a normal peso-and-centavo value. Matching the string
// itself sidesteps floating-point entirely.
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

export function parseMoney(
  raw: FormDataEntryValue | null,
  opts: { allowBlank?: boolean; requirePositive?: boolean } = {}
): ParsedMoney {
  const value = String(raw ?? "").trim();
  if (value === "") return opts.allowBlank ? null : "bad";

  // Reject more precision than numeric(_,2) can hold rather than letting
  // Postgres round it silently. Also rejects a leading "-" (negative
  // amounts), so the finite/non-negative check below is now redundant for
  // any string that reaches it, but stays as a defensive backstop.
  if (!MONEY_PATTERN.test(value)) return "bad";

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "bad";
  if (opts.requirePositive && parsed <= 0) return "bad";
  return parsed;
}

/** Whole-number parse for quantities. Blank → null (meaning "not tracked"). */
export function parseWholeNumber(
  raw: FormDataEntryValue | null,
  opts: { allowNegative?: boolean } = {}
): number | null | "bad" {
  const value = String(raw ?? "").trim();
  if (value === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return "bad";
  if (parsed < 0 && !opts.allowNegative) return "bad";
  return parsed;
}
