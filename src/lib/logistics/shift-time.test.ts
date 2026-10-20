import { describe, it, expect } from 'vitest';
import { formatTime, formatDateFull } from '@/lib/dates';
import {
  addDays, campDayOf, campInstant, eventWindow, formatMinutes, formatWindow,
  isCivilDay, minutesBetween, parseClock, EVENT_DAY_COUNT,
} from './shift-time';

describe('a clock', () => {
  it('reads HH:MM and nothing else', () => {
    expect(parseClock('16:00')).toEqual({ hours: 16, minutes: 0 });
    expect(parseClock(' 09:30 ')).toEqual({ hours: 9, minutes: 30 });
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('9:30')).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock('16.00')).toBeNull();
  });
});

describe('a civil day', () => {
  it('accepts only a real YYYY-MM-DD', () => {
    expect(isCivilDay('2026-06-08')).toBe(true);
    expect(isCivilDay('2026-02-30')).toBe(false);
    expect(isCivilDay('2026-6-8')).toBe(false);
    expect(isCivilDay('')).toBe(false);
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-06-29', 3)).toBe('2026-07-02');
    expect(addDays('2026-06-08', 0)).toBe('2026-06-08');
  });

  it('is the day in Israel, not in UTC', () => {
    // 23:30 UTC on the 7th is 02:30 on the 8th in Israel in June.
    expect(campDayOf(new Date('2026-06-07T23:30:00Z'))).toBe('2026-06-08');
  });
});

describe('an instant on the camp clock', () => {
  it('is 16:00 in Israel, whatever the server clock says', () => {
    const at = campInstant('2026-06-08', { hours: 16, minutes: 0 });
    // Israel is UTC+3 in June.
    expect(at.toISOString()).toBe('2026-06-08T13:00:00.000Z');
    // And `src/lib/dates.ts` reads it back the same, so the two zone
    // constants agree.
    expect(formatTime(at)).toBe('16:00');
    expect(formatDateFull(at)).toBe('08/06/2026');
  });

  it('knows winter from summer', () => {
    const at = campInstant('2026-01-12', { hours: 16, minutes: 0 });
    expect(at.toISOString()).toBe('2026-01-12T14:00:00.000Z');
    expect(formatTime(at)).toBe('16:00');
  });
});

describe('the event window', () => {
  // The gate is stored as a day, at UTC midnight, by the season-date drawer.
  const window = eventWindow(new Date('2026-06-08T00:00:00Z'));

  it('runs from the gate day at 16:00 to the fifth day after at noon', () => {
    expect(window.startsAt.toISOString()).toBe('2026-06-08T13:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-06-13T09:00:00.000Z');
  });

  it('is six days, Monday to Saturday when the gate is a Monday', () => {
    expect(window.days).toHaveLength(EVENT_DAY_COUNT);
    expect(window.days.map((day) => day.day)).toEqual([
      '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13',
    ]);
    expect(window.days.map((day) => day.weekday)).toEqual([
      'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת',
    ]);
    expect(window.days[0].dayMonth).toBe('08/06');
  });

  it('names the day the gate really is, when it is not a Monday', () => {
    const odd = eventWindow(new Date('2026-06-10T00:00:00Z'));
    expect(odd.days[0].weekday).toBe('יום רביעי');
  });
});

describe('a window on screen', () => {
  it('reads as a range, and says when it ends the next day', () => {
    const starts = campInstant('2026-06-08', { hours: 22, minutes: 0 });
    const sameDay = campInstant('2026-06-08', { hours: 23, minutes: 30 });
    const nextDay = campInstant('2026-06-09', { hours: 2, minutes: 0 });
    const midnight = campInstant('2026-06-09', { hours: 0, minutes: 0 });
    expect(formatWindow(starts, sameDay)).toBe('22:00–23:30');
    expect(formatWindow(starts, midnight)).toBe('22:00–00:00');
    expect(formatWindow(starts, nextDay)).toBe('22:00–02:00 (למחרת)');
    expect(minutesBetween(starts, nextDay)).toBe(240);
  });

  it('says a load in hours or minutes, in Hebrew', () => {
    expect(formatMinutes(240)).toBe('4 שעות');
    expect(formatMinutes(210)).toBe('3.5 שעות');
    expect(formatMinutes(45)).toBe('45 דק׳');
  });
});
