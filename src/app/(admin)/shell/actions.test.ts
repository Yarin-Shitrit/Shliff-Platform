import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { listSeasons } from '@/lib/members/roster';
import type { AdminCheck } from '@/lib/auth/guard';

/**
 * `./actions` imports `@/db` at module scope (which throws without
 * `DATABASE_URL`) and `@/lib/auth/guard` (which reaches NextAuth) — both are
 * replaced before the module is imported, the same way
 * `src/app/api/uploads/route.test.ts` does it. The database stand-in is a
 * proxy rather than a fixed object: each test builds its own PGlite instance
 * in `beforeEach`, long after the module namespace has been captured, so
 * every property access has to resolve against whichever instance is
 * current — this is what makes `createSeasonAction` genuinely
 * database-backed rather than exercising a mock of `createSeason`.
 */
const { dbRef, adminRef, dbProxy, revalidatePath } = vi.hoisted(() => {
  const dbRef: { current: TestDb | null } = { current: null };
  const adminRef: { current: AdminCheck } = {
    current: { ok: true, email: 'admin@example.com' },
  };
  const dbProxy = new Proxy({} as TestDb, {
    get(_target, property) {
      const db = dbRef.current;
      if (!db) throw new Error('test database not initialised');
      const value = Reflect.get(db, property) as unknown;
      return typeof value === 'function' ? value.bind(db) : value;
    },
  });
  return { dbRef, adminRef, dbProxy, revalidatePath: vi.fn() };
});

vi.mock('@/db', () => ({ db: dbProxy }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => adminRef.current }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { createSeasonAction } from './actions';

describe('createSeasonAction', () => {
  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'admin@example.com' };
    revalidatePath.mockClear();
  });

  it('creates a season with the values typed, and it appears in the list afterwards', async () => {
    const result = await createSeasonAction({ name: 'ברן 23', year: '2023', flatRate: '1350' });

    expect(result).toEqual({ ok: true });
    const seasons = await listSeasons(dbRef.current!);
    const created = seasons.find((season) => season.name === 'ברן 23');
    expect(created).toBeDefined();
    expect(created?.year).toBe(2023);
    expect(created?.flatRate).toBe('1350.00');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('refuses a blank flat rate, in Hebrew, and creates nothing', async () => {
    const result = await createSeasonAction({ name: 'ברן 23', year: '2023', flatRate: '' });

    expect(result).toEqual({ ok: false, error: 'יש להזין דמי קאמפ.' });
    expect(await listSeasons(dbRef.current!)).toHaveLength(0);
  });

  it('refuses a blank name, in Hebrew, and creates nothing', async () => {
    const result = await createSeasonAction({ name: '  ', year: '2023', flatRate: '1200' });

    expect(result).toEqual({ ok: false, error: 'יש להזין שם לשנה.' });
    expect(await listSeasons(dbRef.current!)).toHaveLength(0);
  });

  it('refuses a blank calendar year, in Hebrew, and creates nothing', async () => {
    const result = await createSeasonAction({ name: 'ברן 23', year: '', flatRate: '1200' });

    expect(result).toEqual({ ok: false, error: 'יש להזין שנה קלנדרית.' });
    expect(await listSeasons(dbRef.current!)).toHaveLength(0);
  });

  it('refuses a duplicate name, in Hebrew, naming the clash — and creates nothing new', async () => {
    const first = await createSeasonAction({ name: 'ברן 26', year: '2026', flatRate: '1200' });
    expect(first).toEqual({ ok: true });

    const second = await createSeasonAction({ name: 'ברן 26', year: '2026', flatRate: '1200' });

    expect(second).toEqual({ ok: false, error: 'כבר קיימת שנה בשם "ברן 26".' });
    expect(await listSeasons(dbRef.current!)).toHaveLength(1);
  });

  it('leaves plannedSize and startsOn null when they are left empty', async () => {
    const result = await createSeasonAction({ name: 'ברן 24', year: '2024', flatRate: '1000' });

    expect(result).toEqual({ ok: true });
    const [season] = await listSeasons(dbRef.current!);
    expect(season.plannedSize).toBeNull();
    expect(season.startsOn).toBeNull();
  });

  it('stores plannedSize and startsOn when they are given', async () => {
    const result = await createSeasonAction({
      name: 'ברן 25', year: '2025', flatRate: '1500', plannedSize: '40', startsOn: '2025-08-01',
    });

    expect(result).toEqual({ ok: true });
    const [season] = await listSeasons(dbRef.current!);
    expect(season.plannedSize).toBe(40);
    expect(season.startsOn?.toISOString().slice(0, 10)).toBe('2025-08-01');
  });

  it('refuses a non-admin and writes nothing', async () => {
    adminRef.current = { ok: false };

    const result = await createSeasonAction({ name: 'ברן 27', year: '2027', flatRate: '900' });

    expect(result).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await listSeasons(dbRef.current!)).toHaveLength(0);
  });
});
