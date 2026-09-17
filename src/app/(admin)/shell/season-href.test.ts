import { describe, it, expect } from 'vitest';
import { seasonHref } from '@/app/(admin)/shell/season-href';

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
