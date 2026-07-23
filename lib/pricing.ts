/** Parses a raw numeric input string, treating blank/invalid/non-positive as 0
    — used to feed the restock calculator, which only shows once both inputs
    are meaningfully filled in. */
export function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const MARKUP = 0.2;

/** Selling price rounded UP to the centavo, so the markup is never short
    (rounding down would land the margin a fraction of a centavo under 30%). */
export function sellingPriceFor(costPerPiece: number): number {
  return Math.ceil(costPerPiece * (1 + MARKUP) * 100) / 100;
}

/** Reverse of sellingPriceFor — also rounded UP to the centavo, so a cost
    estimated backward from a selling price never understates the real cost
    (which would make the margin look better than it actually is). */
export function costPerPieceFor(sellingPrice: number): number {
  return Math.ceil((sellingPrice / (1 + MARKUP)) * 100) / 100;
}

/** Total batch cost implied by a selling price and quantity — costPerPieceFor
    times quantity, re-rounded to the centavo (the multiply can otherwise land
    on a floating-point value like 0.30000000000000004). */
export function costFor(sellingPrice: number, quantity: number): number {
  return Math.round(costPerPieceFor(sellingPrice) * quantity * 100) / 100;
}
