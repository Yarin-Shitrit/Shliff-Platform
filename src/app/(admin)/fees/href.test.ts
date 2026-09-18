import { describe, it, expect } from 'vitest';
import { feesHref } from './href';

const SEASON = '8f2b1c4e-0000-4000-8000-000000000001';

describe('feesHref', () => {
  it('always carries the season, because the season is global (R5)', () => {
    expect(feesHref({ season: SEASON })).toBe(`/fees?season=${SEASON}`);
  });

  it('leaves the default view out, so the canonical link stays short', () => {
    expect(feesHref({ season: SEASON, view: 'all' })).toBe(`/fees?season=${SEASON}`);
  });

  it('carries a chosen view', () => {
    expect(feesHref({ season: SEASON, view: 'unpaid' }))
      .toBe(`/fees?season=${SEASON}&view=unpaid`);
  });

  it('carries the payment drawer as a URL, so it can be sent to someone (R6)', () => {
    expect(feesHref({ season: SEASON, view: 'unpaid', pay: 'p1' }))
      .toBe(`/fees?season=${SEASON}&view=unpaid&peek=p1&act=pay`);
  });

  it('carries the exception drawer', () => {
    expect(feesHref({ season: SEASON, exception: 'p1' }))
      .toBe(`/fees?season=${SEASON}&peek=p1&act=exception`);
  });

  it('never opens two drawers at once', () => {
    expect(feesHref({ season: SEASON, pay: 'p1', exception: 'p2' }))
      .toBe(`/fees?season=${SEASON}&peek=p1&act=pay`);
  });
});
