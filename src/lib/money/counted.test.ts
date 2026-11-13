import { describe, it, expect } from 'vitest';
import { insideCount, campDayKey } from './counted';

describe('insideCount', () => {
  const countedOn = new Date('2025-10-30T00:00:00Z');

  it('holds a movement before the count day and one on it, and frees one after', () => {
    expect(insideCount(new Date('2025-10-16T00:00:00Z'), countedOn)).toBe(true);
    expect(insideCount(new Date('2025-10-30T00:00:00Z'), countedOn)).toBe(true);
    expect(insideCount(new Date('2025-10-31T00:00:00Z'), countedOn)).toBe(false);
  });

  /**
   * The cut is by camp calendar day, not by instant. A manual movement typed
   * on the count day is stored at Israel midnight — 22:00Z the evening
   * before, in winter time (21:00Z in summer) — and must still be the count
   * day; a promoted row of the same day is stored at midnight UTC and must
   * be too. And 22:30Z on the count day is already the next day in Israel,
   * so it is after the count. Both edges are checked, so a comparison that
   * read the UTC day would fail here rather than agree by luck.
   */
  it('reads the day in the camp calendar, so both spellings of the count day are inside it', () => {
    expect(insideCount(new Date('2025-10-29T22:00:00Z'), countedOn)).toBe(true);
    expect(insideCount(new Date('2025-10-30T00:00:00Z'), countedOn)).toBe(true);
    expect(insideCount(new Date('2025-10-30T22:30:00Z'), countedOn)).toBe(false);
  });

  it('holds nothing when the balance was never counted', () => {
    expect(insideCount(new Date('2000-01-01T00:00:00Z'), null)).toBe(false);
  });

  it('keys a day so that string order is date order', () => {
    expect(campDayKey(new Date('2025-10-30T00:00:00Z'))).toBe('2025-10-30');
    // 22:00Z on the 29th is midnight on the 30th in Israel's winter time.
    expect(campDayKey(new Date('2025-10-29T22:00:00Z'))).toBe('2025-10-30');
    // In summer time the offset is three hours: 21:00Z on 15 June is the 16th.
    expect(campDayKey(new Date('2025-06-15T21:00:00Z'))).toBe('2025-06-16');
    expect(campDayKey(new Date('2026-01-05T00:00:00Z')) > campDayKey(countedOn)).toBe(true);
  });
});
