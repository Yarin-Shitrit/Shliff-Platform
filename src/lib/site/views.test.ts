import { describe, it, expect } from 'vitest';
import {
  addDays, burnDays, copyHref, itemHref, parseSiteQuery, plotHref, readSunDate, removeItemHref, seasonDateHref, siteHref,
  sunDateOf,
} from './views';

describe('the camp map’s address', () => {
  it('asks for the 3D map only with ?editor=3d', () => {
    expect(parseSiteQuery({ season: 's26', editor: '3d' }).editor3d).toBe(true);
    expect(parseSiteQuery({ editor: ['3d', '2d'] }).editor3d).toBe(true);
    expect(parseSiteQuery({ season: 's26' }).editor3d).toBe(false);
    expect(parseSiteQuery({ editor: '2d' }).editor3d).toBe(false);
    expect(parseSiteQuery({ editor: '' }).editor3d).toBe(false);
  });

  /* While the flag exists (Task 26 retires it), a link the editor builds —
     the plot settings, a drawer's close — must lead back to the editor, not
     drop the lead onto the board. */
  it('keeps ?editor=3d on every link it builds, and nothing else of the flag', () => {
    const inEditor = { season: 's26', editor: '3d' };
    expect(siteHref(inEditor)).toBe('/site?season=s26&editor=3d');
    expect(plotHref(inEditor)).toBe('/site?season=s26&editor=3d&act=plot');
    expect(copyHref(inEditor)).toBe('/site?season=s26&editor=3d&act=copy');
    expect(itemHref(inEditor, 'a')).toBe('/site?season=s26&editor=3d&peek=a');
    expect(removeItemHref(inEditor, 'a')).toBe('/site?season=s26&editor=3d&peek=a&act=remove');
    // Any other value is not the flag, and is not carried.
    expect(siteHref({ season: 's26', editor: '2d' })).toBe('/site?season=s26');
    expect(plotHref({ season: 's26' })).toBe('/site?season=s26&act=plot');
  });

  it('opens the season’s opening date from here, for the season on screen (ruling SD4)', () => {
    // The shell's drawer (`?act=season-date`) edits the season `?season=` names.
    expect(seasonDateHref({ season: 's26', peek: 'a', act: 'plot' })).toBe('/site?season=s26&act=season-date');
    expect(seasonDateHref({})).toBe('/site?act=season-date');
    // Nothing on the site page reads it as one of its own drawers.
    const query = parseSiteQuery({ season: 's26', act: 'season-date' });
    expect([query.plot, query.copy, query.removing]).toEqual([false, false, false]);
  });
});

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

describe('the days of the burn', () => {
  it('moves a day on by whole calendar days, across a month, a year and a leap day', () => {
    expect(addDays('2026-11-02', 0)).toBe('2026-11-02');
    expect(addDays('2026-11-02', 5)).toBe('2026-11-07');
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  });

  it('is calendar arithmetic, untouched by the night the clocks change', () => {
    // Israel leaves summer time in the small hours of 25 October 2026.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-26', 1)).toBe('2026-03-27');
  });

  it('moves no day that is not one, and no part of a day', () => {
    for (const text of ['', 'soon', '2026-11-2', '2026-02-30']) expect(addDays(text, 1)).toBeNull();
    expect(addDays('2026-11-02', 0.5)).toBeNull();
    expect(addDays('2026-11-02', Number.NaN)).toBeNull();
    // Past the four-digit years `readSunDate` reads, there is no day to give.
    expect(addDays('9999-12-31', 1)).toBeNull();
  });

  it('runs from the gate day to the last day, each once, in order', () => {
    expect(burnDays('2026-11-02', '2026-11-07')).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07',
    ]);
    expect(burnDays('2026-10-30', '2026-11-01')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(burnDays('2026-11-02', '2026-11-02')).toEqual(['2026-11-02']);
  });

  it('is the gate day alone while the last day is unknown — never a guessed length (SIM3)', () => {
    expect(burnDays('2026-11-02', null)).toEqual(['2026-11-02']);
    expect(burnDays('2026-11-02', 'soon')).toEqual(['2026-11-02']);
    // A last day before the first is no last day.
    expect(burnDays('2026-11-02', '2026-11-01')).toEqual(['2026-11-02']);
  });

  it('has no days without a gate day', () => {
    expect(burnDays(null, '2026-11-07')).toEqual([]);
    expect(burnDays('2026-02-30', '2026-11-07')).toEqual([]);
  });
});
