import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { persons } from '@/db/schema/camp';
import {
  createSeason, listSeasons, getSeasonByName,
  addMember, listRoster, removeMember, setSeasonStartsOn,
} from '@/lib/members/roster';

describe('roster', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  async function person(name: string) {
    const [row] = await db.insert(persons).values({ displayName: name }).returning();
    return row;
  }

  it('creates a season with its flat rate', async () => {
    const season = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    expect(season.flatRate).toBe('1500.00');
    expect(season.plannedSize).toBe(43);
  });

  it('lists seasons newest first', async () => {
    await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    expect((await listSeasons(db)).map((s) => s.name)).toEqual(['ברן 26', 'ברן 25']);
  });

  it('finds a season by name', async () => {
    await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    expect((await getSeasonByName(db, 'ברן 26'))?.year).toBe(2026);
    expect(await getSeasonByName(db, 'ברן 99')).toBeUndefined();
  });

  it('adds members and lists the roster alphabetically', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    const yosef = await person('יוסף');
    await addMember(db, ofek.id, season.id);
    await addMember(db, yosef.id, season.id, 'lead');

    const roster = await listRoster(db, season.id);
    expect(roster.map((r) => r.displayName)).toEqual(['אופק', 'יוסף']);
    expect(roster.find((r) => r.displayName === 'יוסף')?.role).toBe('lead');
  });

  it('is idempotent — adding the same member twice does not duplicate', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    await addMember(db, ofek.id, season.id);
    await addMember(db, ofek.id, season.id, 'lead');

    const roster = await listRoster(db, season.id);
    expect(roster).toHaveLength(1);
    expect(roster[0].role).toBe('lead');
  });

  it('keeps a person across seasons', async () => {
    const s25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    await addMember(db, ofek.id, s25.id);
    await addMember(db, ofek.id, s26.id);

    expect(await listRoster(db, s25.id)).toHaveLength(1);
    expect(await listRoster(db, s26.id)).toHaveLength(1);
  });

  it('removes a member from one season only', async () => {
    const s25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await person('אופק');
    await addMember(db, ofek.id, s25.id);
    await addMember(db, ofek.id, s26.id);
    await removeMember(db, ofek.id, s26.id);

    expect(await listRoster(db, s25.id)).toHaveLength(1);
    expect(await listRoster(db, s26.id)).toHaveLength(0);
  });

  describe('setSeasonStartsOn', () => {
    it('sets the gate date on a season that had none', async () => {
      const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

      const updated = await setSeasonStartsOn(db, season.id, new Date('2026-06-04'));

      expect(updated?.startsOn?.toISOString()).toBe('2026-06-04T00:00:00.000Z');
      expect((await getSeasonByName(db, 'ברן 26'))?.startsOn?.toISOString())
        .toBe('2026-06-04T00:00:00.000Z');
    });

    it('changes a date that was already set', async () => {
      const season = await createSeason(db, {
        name: 'ברן 26', year: 2026, flatRate: 1200, startsOn: new Date('2026-06-04'),
      });

      await setSeasonStartsOn(db, season.id, new Date('2026-06-11'));

      expect((await getSeasonByName(db, 'ברן 26'))?.startsOn?.toISOString())
        .toBe('2026-06-11T00:00:00.000Z');
    });

    it('clears the date when given null', async () => {
      const season = await createSeason(db, {
        name: 'ברן 26', year: 2026, flatRate: 1200, startsOn: new Date('2026-06-04'),
      });

      const updated = await setSeasonStartsOn(db, season.id, null);

      expect(updated?.startsOn).toBeNull();
      expect((await getSeasonByName(db, 'ברן 26'))?.startsOn).toBeNull();
    });

    it('touches only the season it names', async () => {
      await createSeason(db, {
        name: 'ברן 25', year: 2025, flatRate: 1500, startsOn: new Date('2025-06-05'),
      });
      const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

      await setSeasonStartsOn(db, s26.id, new Date('2026-06-04'));

      expect((await getSeasonByName(db, 'ברן 25'))?.startsOn?.toISOString())
        .toBe('2025-06-05T00:00:00.000Z');
    });

    it('returns undefined, and writes nothing, for an id no season has', async () => {
      await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

      const updated = await setSeasonStartsOn(
        db, '00000000-0000-4000-8000-000000000000', new Date('2026-06-04'),
      );

      expect(updated).toBeUndefined();
      expect((await getSeasonByName(db, 'ברן 26'))?.startsOn).toBeNull();
    });

    /**
     * Postgres refuses a malformed uuid with `invalid input syntax for type
     * uuid` rather than matching nothing — the same trap `link.ts` guards.
     * A truncated id is still "no such season", not a crash.
     */
    it('returns undefined for an id that is not a uuid at all, rather than throwing', async () => {
      await expect(setSeasonStartsOn(db, 'not-a-uuid', new Date('2026-06-04')))
        .resolves.toBeUndefined();
    });
  });
});
