import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { resolveSeason } from '@/lib/seasons/current';

describe('resolveSeason', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('returns no season and no list for a camp with no seasons', async () => {
    expect(await resolveSeason(db, undefined)).toEqual({ seasons: [], current: null });
  });

  it('defaults to the newest season', async () => {
    await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

    const { seasons, current } = await resolveSeason(db, undefined);
    expect(seasons.map((season) => season.name)).toEqual(['ברן 26', 'ברן 25']);
    expect(current?.name).toBe('ברן 26');
  });

  it('honours ?season= and hands back the whole list beside it', async () => {
    const older = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

    const { seasons, current } = await resolveSeason(db, older.id);
    expect(current?.name).toBe('ברן 25');
    expect(seasons).toHaveLength(2);
  });
});
