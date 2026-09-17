import { describe, it, expect } from 'vitest';
import { pickSeason } from '@/lib/seasons/pick';

const SEASONS = [
  { id: 'b26', name: 'ברן 26' },
  { id: 'b25', name: 'ברן 25' },
  { id: 'b24', name: 'ברן 24' },
];

describe('pickSeason', () => {
  it('takes the newest when nothing is asked for', () => {
    expect(pickSeason(SEASONS, undefined)?.id).toBe('b26');
    expect(pickSeason(SEASONS, null)?.id).toBe('b26');
    expect(pickSeason(SEASONS, '')?.id).toBe('b26');
  });

  it('takes the season that was asked for', () => {
    expect(pickSeason(SEASONS, 'b25')?.id).toBe('b25');
  });

  it('falls back to the newest when the id names no season', () => {
    expect(pickSeason(SEASONS, 'a-season-that-was-deleted')?.id).toBe('b26');
  });

  it('answers null when the camp has no seasons at all', () => {
    expect(pickSeason([], 'b26')).toBeNull();
  });
});
