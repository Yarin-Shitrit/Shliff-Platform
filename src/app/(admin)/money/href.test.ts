import { describe, it, expect } from 'vitest';
import { moneyHref } from './href';

describe('moneyHref', () => {
  it('keeps the season on every link (R5)', () => {
    expect(moneyHref({ season: 's1' })).toBe('/money?season=s1');
    expect(moneyHref({ season: 's1', count: 'a1' })).toBe('/money?season=s1&account=a1&act=count');
    expect(moneyHref({ season: 's1', newAccount: true })).toBe('/money?season=s1&act=new-account');
  });

  it('opens one drawer at a time, the count winning', () => {
    expect(moneyHref({ season: 's1', count: 'a1', newAccount: true }))
      .toBe('/money?season=s1&account=a1&act=count');
  });
});
