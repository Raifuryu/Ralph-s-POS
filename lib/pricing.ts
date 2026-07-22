/** Parses a raw numeric input string, treating blank/invalid/non-positive as 0
    — used to feed the restock calculator, which only shows once both inputs
    are meaningfully filled in. */
export function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const MARKUP = 0.3;

/** Selling price rounded UP to the centavo, so the markup is never short
    (rounding down would land the margin a fraction of a centavo under 30%). */
export function sellingPriceFor(costPerPiece: number): number {
  return Math.ceil(costPerPiece * (1 + MARKUP) * 100) / 100;
}
