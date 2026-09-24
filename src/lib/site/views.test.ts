import { describe, it, expect } from 'vitest';
import { readSunDate, sunDateOf } from './views';

describe('the day shade by hour is worked out for', () => {
  it('is the gate day as a calendar date in Israel, not in UTC', () => {
    // 22:30 UTC on 3 June is 01:30 on 4 June in Israel (summer time, UTC+3).
    expect(sunDateOf(new Date('2026-06-03T22:30:00Z'))).toBe('2026-06-04');
    expect(sunDateOf(new Date('2026-06-04T09:00:00Z'))).toBe('2026-06-04');
  });

  it('is nothing when the season has no gate day, rather than a guess', () => {
    expect(sunDateOf(null)).toBeNull();
  });

  it('is read back only as a real day written the way sunDateOf writes it', () => {
    expect(readSunDate('2026-06-04')).toBe('2026-06-04');
    expect(readSunDate(sunDateOf(new Date('2026-06-03T22:30:00Z')))).toBe('2026-06-04');
    // Anything else is no day — never a day the sun is then worked out for by guess.
    for (const text of [null, '', 'soon', '2026-6-4', '04/06/2026', '2026-06-04T00:00', ' 2026-06-04', '2026-02-31', '2026-13-01']) {
      expect(readSunDate(text)).toBeNull();
    }
  });
});
