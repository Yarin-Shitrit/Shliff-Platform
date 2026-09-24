import { describe, it, expect } from 'vitest';
import {
  copyHref, itemHref, parseSiteQuery, plotHref, readSunDate, removeItemHref, siteHref, sunDateOf,
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
