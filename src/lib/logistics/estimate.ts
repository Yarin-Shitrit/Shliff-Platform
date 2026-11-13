/**
 * What a purchase row is expected to cost: the price of one, times how many.
 *
 * A lead prices one unit — that is the number on the shelf tag — and the
 * system does the multiplying, in agorot, in this one place. The drawer shows
 * the product while the lead types and the table, the tiles and the export
 * read the same function, so the four can never disagree.
 *
 * Pure, with no database import, because the drawer is a client component
 * and calls it on every keystroke.
 */

/** Null stays null: "nobody has priced it" times any count is still unpriced. */
export function rowEstimateAgorot(unitAgorot: number | null, quantity: number): number | null {
  return unitAgorot === null ? null : unitAgorot * quantity;
}

export interface TypedEstimate {
  quantity: number;
  unitAgorot: number;
  totalAgorot: number;
}

/**
 * The product of what is in the two boxes right now, or null while either
 * cannot be read as a number — an empty price, a count of zero, half a word.
 * Null means "show nothing": the form's own refusals say what is wrong, and a
 * total computed from a guess would be a figure nobody typed.
 */
export function typedEstimate(price: string, quantity: string): TypedEstimate | null {
  const count = Number(quantity.trim());
  if (quantity.trim() === '' || !Number.isInteger(count) || count < 1) return null;

  const typed = price.trim();
  if (typed === '') return null;
  const shekels = Number(typed);
  if (!Number.isFinite(shekels) || shekels < 0) return null;

  const unitAgorot = Math.round(shekels * 100);
  return { quantity: count, unitAgorot, totalAgorot: unitAgorot * count };
}
