import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, getSeasonByName, listSeasons } from '@/lib/members/roster';
import type { AdminCheck } from '@/lib/auth/guard';
import { HEBREW_FALLBACK } from '@/lib/errors/hebrew';

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

import { createSeasonAction, setSeasonStartsOnAction } from './actions';

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

  /**
   * `new Date` read both of these without complaint: `2026-02-30` as
   * 2 March, `4/6/2026` month-first as 6 April. The season was created with
   * a gate date nobody typed.
   */
  it.each(['2026-02-30', '4/6/2026'])(
    'refuses an impossible or non-ISO gate date %j, in Hebrew, and creates nothing',
    async (startsOn) => {
      const result = await createSeasonAction({
        name: 'ברן 26', year: '2026', flatRate: '1200', startsOn,
      });

      expect(result).toEqual({ ok: false, error: 'תאריך פתיחת השער אינו תקין.' });
      expect(await listSeasons(dbRef.current!)).toHaveLength(0);
    },
  );

  it('refuses a non-admin and writes nothing', async () => {
    adminRef.current = { ok: false };

    const result = await createSeasonAction({ name: 'ברן 27', year: '2027', flatRate: '900' });

    expect(result).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await listSeasons(dbRef.current!)).toHaveLength(0);
  });

  /**
   * Integration §5 A27. This screen used to match the prefix
   * `Failed query: insert into "seasons"` — the wrapper's SQL text, which is
   * identical for every failed insert into the table. Its author argued that
   * `name` was the only constraint the insert could still violate after the
   * checks above, and that was true; but it was an invariant held by a
   * comment, and this is the case that shows what it costs when the comment
   * stops being true.
   *
   * The year passes every check above — `Number.isInteger(99999999999)` is
   * true — and then overflows int4 in the database. The old prefix matched
   * anyway and told a lead `כבר קיימת שנה בשם "ברן 28".`, a confident,
   * specific and entirely wrong reason. A generic cause claimed from a
   * generic symptom is a guess, and the fallback is the honest answer.
   */
  it('does not report a duplicate name for a failure that has nothing to do with the name', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await createSeasonAction({
      name: 'ברן 28', year: '99999999999', flatRate: '1200',
    });

    expect(result).toEqual({ ok: false, error: HEBREW_FALLBACK });
    expect(await listSeasons(dbRef.current!)).toHaveLength(0);
  });
});

describe('setSeasonStartsOnAction', () => {
  beforeEach(async () => {
    dbRef.current = await createTestDb();
    adminRef.current = { ok: true, email: 'admin@example.com' };
    revalidatePath.mockClear();
  });

  async function season(startsOn?: Date) {
    return createSeason(dbRef.current!, { name: 'ברן 26', year: 2026, flatRate: 1200, startsOn });
  }

  async function stored(): Promise<string | null | undefined> {
    const row = await getSeasonByName(dbRef.current!, 'ברן 26');
    return row?.startsOn === null ? null : row?.startsOn.toISOString();
  }

  it('sets the date on a season that had none, as UTC midnight — the way create stores it', async () => {
    const { id } = await season();

    const result = await setSeasonStartsOnAction(id, '2026-06-04');

    expect(result).toEqual({ ok: true });
    expect(await stored()).toBe('2026-06-04T00:00:00.000Z');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('stores the same instant create would for the same typed date', async () => {
    await createSeasonAction({ name: 'ברן 25', year: '2025', flatRate: '1500', startsOn: '2025-06-05' });
    const { id } = await season();

    await setSeasonStartsOnAction(id, '2025-06-05');

    const created = await getSeasonByName(dbRef.current!, 'ברן 25');
    expect(await stored()).toBe(created?.startsOn?.toISOString());
  });

  it('changes a date that was already set', async () => {
    const { id } = await season(new Date('2026-06-04'));

    const result = await setSeasonStartsOnAction(id, '2026-06-11');

    expect(result).toEqual({ ok: true });
    expect(await stored()).toBe('2026-06-11T00:00:00.000Z');
  });

  it('treats a blank value as an explicit clear', async () => {
    const { id } = await season(new Date('2026-06-04'));

    const result = await setSeasonStartsOnAction(id, '');

    expect(result).toEqual({ ok: true });
    expect(await stored()).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  /**
   * A server action is a public endpoint and its types are not enforced at
   * runtime. A call that leaves the value out has not asked for a clear, so
   * it is not read as one.
   */
  it('refuses a missing value rather than reading it as a clear', async () => {
    const { id } = await season(new Date('2026-06-04'));

    const result = await setSeasonStartsOnAction(id, undefined as unknown as string);

    expect(result).toEqual({ ok: false, error: 'תאריך פתיחת השער אינו תקין.' });
    expect(await stored()).toBe('2026-06-04T00:00:00.000Z');
  });

  it('treats whitespace as blank too', async () => {
    const { id } = await season(new Date('2026-06-04'));

    expect(await setSeasonStartsOnAction(id, '   ')).toEqual({ ok: true });
    expect(await stored()).toBeNull();
  });

  /**
   * `new Date('2026-02-30')` does not refuse: it rolls over to 2 March and
   * would store a day nobody typed. `2026-6-4` parses too — as local
   * midnight, not UTC — so the shape is checked as well as the value.
   */
  it.each(['לא תאריך', '2026-02-30', '2026-13-01', '2026-6-4', '4/6/2026'])(
    'refuses %j in Hebrew and leaves the stored date alone',
    async (typed) => {
      const { id } = await season(new Date('2026-06-04'));

      const result = await setSeasonStartsOnAction(id, typed);

      expect(result).toEqual({ ok: false, error: 'תאריך פתיחת השער אינו תקין.' });
      expect(await stored()).toBe('2026-06-04T00:00:00.000Z');
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('refuses a non-admin and writes nothing', async () => {
    const { id } = await season(new Date('2026-06-04'));
    adminRef.current = { ok: false };

    const result = await setSeasonStartsOnAction(id, '2026-06-11');

    expect(result).toEqual({ ok: false, error: 'אין הרשאה' });
    expect(await stored()).toBe('2026-06-04T00:00:00.000Z');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a season id that does not exist, in Hebrew', async () => {
    await season();

    const result = await setSeasonStartsOnAction('00000000-0000-4000-8000-000000000000', '2026-06-04');

    expect(result).toEqual({ ok: false, error: 'השנה לא נמצאה.' });
    expect(await stored()).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a malformed id in the same Hebrew, without throwing a database error', async () => {
    const result = await setSeasonStartsOnAction('not-a-uuid', '2026-06-04');

    expect(result).toEqual({ ok: false, error: 'השנה לא נמצאה.' });
  });
});
