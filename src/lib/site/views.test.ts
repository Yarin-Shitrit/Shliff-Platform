import { describe, it, expect } from 'vitest';
import {
  copyHref, itemHref, parseSiteQuery, plotHref, readSunDate, seasonDateHref, siteHref, sunDateOf,
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
