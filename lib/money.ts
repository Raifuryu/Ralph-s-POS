/**
 * Shared money/quantity input parsing for server actions.
 *
 * Every money field in the app follows the same rules: numeric, at most two
 * decimal places (Postgres numeric(_,2) would otherwise silently round), and
 * non-negative. Variants differ only in whether blank is allowed and whether
 * zero is.
 */

export type ParsedMoney = number | null | "bad";

export function parseMoney(
  raw: FormDataEntryValue | null,
  opts: { allowBlank?: boolean; requirePositive?: boolean } = {}
): ParsedMoney {
  const value = String(raw ?? "").trim();
  if (value === "") return opts.allowBlank ? null : "bad";

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "bad";
  if (opts.requirePositive && parsed <= 0) return "bad";
  // Reject more precision than numeric(_,2) can hold rather than letting
  // Postgres round it silently.
  if (Math.round(parsed * 100) !== parsed * 100) return "bad";
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
