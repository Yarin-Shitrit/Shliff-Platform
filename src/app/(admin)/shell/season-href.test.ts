import { describe, it, expect } from 'vitest';
import { seasonHref, seasonDateHref, SEASON_DATE_ACT } from '@/app/(admin)/shell/season-href';

describe('seasonHref', () => {
  it('adds ?season= to a route that has no query', () => {
    expect(seasonHref('/fees', '', 'b25')).toBe('/fees?season=b25');
  });

  it('replaces the season already in the query and keeps the rest', () => {
    expect(seasonHref('/money', 'season=b26&view=open', 'b25'))
      .toBe('/money?season=b25&view=open');
  });

  it('stays on the route it was called from', () => {
    expect(seasonHref('/members/abc', 'tab=payments', 'b25'))
      .toBe('/members/abc?tab=payments&season=b25');
  });

  it('drops an open drawer, which belonged to the season you left', () => {
    expect(seasonHref('/fees', 'peek=abc&season=b26', 'b25')).toBe('/fees?season=b25');
  });
});

describe('seasonDateHref', () => {
  it('spells the act once, for every caller', () => {
    expect(SEASON_DATE_ACT).toBe('season-date');
  });

  it('opens the gate-date drawer on the route you are standing on', () => {
    expect(seasonDateHref('/fees', new URLSearchParams())).toBe('/fees?act=season-date');
  });

  it('keeps ?season=, which is what names the season being edited', () => {
    expect(seasonDateHref('/site', new URLSearchParams('season=b25&view=board')))
      .toBe('/site?season=b25&view=board&act=season-date');
  });

  it('replaces an open drawer rather than stacking on it (R6)', () => {
    expect(seasonDateHref('/fees', new URLSearchParams('season=b26&peek=p1&act=pay')))
      .toBe('/fees?season=b26&act=season-date');
  });
});
