import { describe, it, expect } from 'vitest';
import {
  toAgorot, fromAgorot, sumAgorot, formatILS, formatShekels,
} from '@/lib/money';

describe('money', () => {
  it('converts a numeric(12,2) string to integer agorot', () => {
    expect(toAgorot('60955.00')).toBe(6095500);
    expect(toAgorot('1500')).toBe(150000);
    expect(toAgorot(0)).toBe(0);
  });

  it('rounds away binary float error rather than truncating', () => {
    // 33740.55 * 100 is 3374054.9999999995 in IEEE 754.
    expect(toAgorot('33740.55')).toBe(3374055);
    expect(toAgorot('11390.8')).toBe(1139080);
  });

  it('round-trips through storage form', () => {
    expect(fromAgorot(6095500)).toBe('60955.00');
    expect(fromAgorot(1139080)).toBe('11390.80');
    expect(toAgorot(fromAgorot(3374055))).toBe(3374055);
  });

  it('refuses a non-integer agorot value', () => {
    expect(() => fromAgorot(1.5)).toThrow(/integer/);
  });

  it('refuses a value that is not a number', () => {
    expect(() => toAgorot('לא מספר')).toThrow(/not a number/);
  });

  it('sums without drift', () => {
    // The twelve ברן 25 reimbursement lines.
    const lines = [300, 65, 400, 709, 820, 200, 335, 500, 400, 40, 580, 1605];
    expect(sumAgorot(lines)).toBe(595400);
    expect(sumAgorot(['33740.55', '11390.8'])).toBe(4513135);
  });

  it('formats for display, dropping empty decimals', () => {
    expect(formatILS(6095500)).toBe('60,955');
    expect(formatILS(3374055)).toBe('33,740.55');
  });

  it('attaches the symbol in one place, last', () => {
    expect(formatShekels(120000)).toBe('1,200 ₪');
    expect(formatShekels(3374055)).toBe('33,740.55 ₪');
    expect(formatShekels(0)).toBe('0 ₪');
  });

  /**
   * A11. The sign and the first digit must be one uninterrupted run. If a
   * '-' is ever prepended to an already-formatted amount in JSX, bidi
   * reordering floats it to the far side of the number and a debt reads as a
   * credit. Formatting the signed number in one call is what prevents it.
   *
   * Node's full-ICU `he-IL` negative-number pattern itself prepends a
   * left-to-right mark (U+200E) before the sign — confirmed with
   * `Intl.NumberFormat('he-IL').formatToParts(-1200)`, which reports it as a
   * `literal` part, and reproduced the same way for `he` and `ur-PK`. It is
   * a zero-width, non-reorderable control character, not a digit or a
   * second sign, so it does not break the sign-to-digit run the assertion
   * is guarding; the regex allows one optional leading occurrence of it.
   */
  it('never lets a minus sign come off its digits', () => {
    const text = formatShekels(-120000);
    expect(text.endsWith(' ₪')).toBe(true);
    expect(text.slice(0, text.length - 2)).toMatch(/^‎?[-−]\d/);
  });
});
