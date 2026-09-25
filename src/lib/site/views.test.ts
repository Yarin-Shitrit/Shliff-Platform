import { describe, it, expect } from 'vitest';
import {
  addDays, burnDays, burnEnd, copyHref, itemHref, MAX_BURN_DAYS, parseSiteQuery, plotHref, readSunDate, seasonDateHref,
  siteHref, sunDateOf,
} from './views';

describe('the camp map’s address', () => {
  it('reads the season, the item to select and the drawer — and nothing the old board read', () => {
    expect(parseSiteQuery({ season: 's26', peek: 'a', act: 'remove', editor: '3d' }))
      .toEqual({ season: 's26', peek: 'a', plot: false, copy: false });
    expect(parseSiteQuery({ act: 'plot' })).toEqual({ season: '', peek: null, plot: true, copy: false });
    expect(parseSiteQuery({ act: ['copy', 'plot'] })).toEqual({ season: '', peek: null, plot: false, copy: true });
  });

  it('links to an item by selecting it on the map', () => {
    expect(itemHref({ season: 's26' }, 'a')).toBe('/site?season=s26&peek=a');
  });

  /* Ruling T26-1: the editor is the page, so `?editor=3d` means nothing any
     more. A link that still carries it (one was handed out) opens the editor
     like any other, and no link this page builds carries it on. */
  it('carries only the season from one link to the next — an old ?editor=3d is dropped', () => {
    const old = { season: 's26', editor: '3d', peek: 'a', act: 'plot' };
    expect(siteHref(old)).toBe('/site?season=s26');
    expect(plotHref(old)).toBe('/site?season=s26&act=plot');
    expect(copyHref(old)).toBe('/site?season=s26&act=copy');
    expect(itemHref(old, 'b')).toBe('/site?season=s26&peek=b');
    expect(seasonDateHref(old)).toBe('/site?season=s26&act=season-date');
  });

  it('opens the season’s opening date from here, for the season on screen (ruling SD4)', () => {
    // The shell's drawer (`?act=season-date`) edits the season `?season=` names.
    expect(seasonDateHref({ season: 's26', peek: 'a', act: 'plot' })).toBe('/site?season=s26&act=season-date');
    expect(seasonDateHref({})).toBe('/site?act=season-date');
    // Nothing on the site page reads it as one of its own drawers.
    expect(parseSiteQuery({ season: 's26', act: 'season-date' }))
      .toEqual({ season: 's26', peek: null, plot: false, copy: false });
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

  /* A burn runs about a week. A last day weeks away is a mistyped date, and
     hundreds of days would be hundreds of chips: it is said, never played. */
  it('is the gate day alone when the last day would make the burn longer than two weeks', () => {
    expect(MAX_BURN_DAYS).toBe(14);
    expect(burnDays('2026-11-02', '2026-11-15')).toHaveLength(14);
    expect(burnDays('2026-11-02', '2026-11-16')).toEqual(['2026-11-02']);
    expect(burnDays('2026-11-02', '2027-11-02')).toEqual(['2026-11-02']);
  });

  it('says what the last day tells about the burn’s length', () => {
    expect(burnEnd('2026-11-02', '2026-11-07')).toBe('known');
    expect(burnEnd('2026-11-02', '2026-11-02')).toBe('known');
    expect(burnEnd('2026-11-02', '2026-11-15')).toBe('known');
    expect(burnEnd('2026-11-02', null)).toBe('missing');
    expect(burnEnd('2026-11-02', 'soon')).toBe('missing');
    expect(burnEnd('2026-11-02', '2026-11-01')).toBe('early');
    expect(burnEnd('2026-11-02', '2026-11-16')).toBe('long');
  });
});
