import { describe, it, expect } from 'vitest';
import {
  formatDateShort, formatDateFull, formatDateProse, formatTime, formatDateTime,
  parseDateInput,
} from '@/lib/dates';

// 19:30 on 7 September 2026 in the camp's timezone (IDT, UTC+3).
const evening = new Date('2026-09-07T16:30:00Z');

describe('dates', () => {
  it('writes a table date with slashes, the way Excel and the banks do', () => {
    expect(formatDateShort(evening)).toBe('07/09/26');
    expect(formatDateFull(evening)).toBe('07/09/2026');
  });

  it('writes a prose date in Hebrew', () => {
    expect(formatDateProse(evening)).toBe('7 בספט׳ 2026');
    expect(formatDateProse(new Date('2026-12-25T10:00:00Z'))).toBe('25 בדצמ׳ 2026');
    expect(formatDateProse(new Date('2026-03-01T10:00:00Z'))).toBe('1 במרץ 2026');
  });

  it('writes a time on the 24-hour clock', () => {
    expect(formatTime(evening)).toBe('19:30');
    expect(formatDateTime(evening)).toBe('07/09/26 19:30');
  });

  /**
   * The day is the camp's day, not the runner's. 22:10 UTC on the 6th is
   * already the 7th in Israel, and a test that passes only where the CI box
   * happens to sit is not a test.
   */
  it("reads the day in the camp's timezone, not the process's", () => {
    expect(formatDateShort(new Date('2026-09-06T22:10:00Z'))).toBe('07/09/26');
    expect(formatTime(new Date('2026-09-06T22:10:00Z'))).toBe('01:10');
  });

  /** And it is a real timezone, not a hardcoded offset: winter is UTC+2. */
  it('follows the summer-time change', () => {
    const winter = new Date('2026-01-31T22:30:00Z');
    expect(formatDateShort(winter)).toBe('01/02/26');
    expect(formatTime(winter)).toBe('00:30');
  });

  it('pads a single-digit day and month in the table forms only', () => {
    const early = new Date('2026-04-05T09:00:00Z');
    expect(formatDateShort(early)).toBe('05/04/26');
    expect(formatDateProse(early)).toBe('5 באפר׳ 2026');
  });
});

describe('parseDateInput', () => {
  it('reads what <input type="date"> submits as UTC midnight of that day', () => {
    expect(parseDateInput('2026-06-04')?.toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });

  it('gives the day back unchanged when read in the camp timezone', () => {
    const day = parseDateInput('2026-06-04');
    expect(day && formatDateFull(day)).toBe('04/06/2026');
  });

  it('accepts a real leap day', () => {
    expect(parseDateInput('2028-02-29')?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('ignores whitespace around the day', () => {
    expect(parseDateInput(' 2026-06-04 ')?.toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });

  /**
   * Every one of these is something `new Date` accepts without complaint:
   * `2026-02-30` rolls over to 2 March, `2026-6-4` and `4/6/2026` are read
   * as local time (the second month-first, so 6 April), and a time of day
   * shifts the instant. Each would store a day nobody typed.
   */
  it.each([
    '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-6-4', '4/6/2026',
    '2026-06-04T10:00', '2026-06-04T00:00:00Z', 'June 4 2026', '20260604',
    'לא תאריך', '', '   ',
  ])('refuses %j', (typed) => {
    expect(parseDateInput(typed)).toBeNull();
  });
});
