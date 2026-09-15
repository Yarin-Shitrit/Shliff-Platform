import { toAgorot } from '@/lib/money';

/** Tolerance for the arithmetic check, in agorot. Half a shekel, matching the
 *  rounding the workbook itself does. */
export const ARITHMETIC_TOLERANCE = 50;

/**
 * Determines whether a budget line's arithmetic is off (quantity × unit ≠ total).
 *
 * Unit cost is a rate, not a stored amount. The right computation is to multiply
 * first and round once at the end (product-first), not to convert the rate to
 * whole agorot before multiplying (which scales rounding error by quantity).
 * For example: 1000 units at ₪0.335/unit = ₪335.00. Rounding the rate to agorot
 * first would give ₪340 (₪5 error). A single toAgorot call at the end absorbs
 * float error for any magnitude this camp records.
 *
 * This must be the single definition of this check: the promoter and the budget
 * table must agree on arithmetic by construction.
 */
export function isArithmeticOff(
  quantityNum: string | number | null,
  unitCost: string | number | null,
  totalAgorot: number,
): boolean {
  if (quantityNum === null || unitCost === null) return false;
  const qty = typeof quantityNum === 'string' ? parseFloat(quantityNum) : quantityNum;
  const cost = typeof unitCost === 'string' ? parseFloat(unitCost) : unitCost;
  const expected = toAgorot(qty * cost);
  return Math.abs(expected - totalAgorot) > ARITHMETIC_TOLERANCE;
}
