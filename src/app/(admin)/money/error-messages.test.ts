import { describe, it, expect, vi } from 'vitest';
import { toHebrewError, HEBREW_FALLBACK, HebrewRefusal } from '@/lib/errors/hebrew';
import { toAgorot } from '@/lib/money';
import { MONEY_ERRORS } from './error-messages';

describe('the money screens Hebrew boundary', () => {
  it('passes a marked refusal through untouched, uuid and all', () => {
    const id = '00000000-0000-0000-0000-00000000000f';
    expect(toHebrewError(new HebrewRefusal(`חוב לא קיים: ${id}`), MONEY_ERRORS))
      .toBe(`חוב לא קיים: ${id}`);
  });

  /**
   * The realistic path, not a hand-written string: an empty number input
   * arrives as `NaN`, `toAgorot` throws in English, and that must not reach a
   * Hebrew screen. Thrown by the real function so the prefix is pinned to
   * what `money.ts` actually says rather than to what this file remembers.
   */
  it('turns the one English message a form can trigger into Hebrew', () => {
    const error = (() => {
      try { toAgorot(Number.NaN); return null; } catch (caught) { return caught; }
    })();
    expect(error).toBeInstanceOf(Error);
    expect(toHebrewError(error, MONEY_ERRORS))
      .toBe('הסכום שהוזן אינו מספר. הקלידו סכום בשקלים.');
  });

  it('replaces an unmapped English message with the Hebrew fallback, and logs it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toHebrewError(new Error('a payment amount must be positive'), MONEY_ERRORS))
      .toBe(HEBREW_FALLBACK);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('replaces anything that is not an Error at all', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toHebrewError({ code: '23505' }, MONEY_ERRORS)).toBe(HEBREW_FALLBACK);
    logged.mockRestore();
  });

  /**
   * R9 turned on the map itself. Every sentence here is what a lead reads, so
   * a Latin character in one is an English string reaching a Hebrew screen by
   * the very route built to prevent that.
   */
  it('has no Latin letter in anything it would render', () => {
    for (const [, hebrew] of MONEY_ERRORS) {
      expect(hebrew).not.toMatch(/[A-Za-z]/);
    }
  });

  it('keys every entry on an English prefix, so a Hebrew throw is never self-mapped', () => {
    for (const [prefix] of MONEY_ERRORS) {
      expect(prefix).toMatch(/^[A-Za-z]/);
    }
  });
});
