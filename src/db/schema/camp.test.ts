import { describe, it, expect } from 'vitest';
import { createTestDb } from '@/test/db';
import {
  persons, personAliases, seasons, memberships, dues, payments,
  campEvents, tasks, taskAssignments, PAYMENT_CHANNELS,
} from '@/db/schema/camp';

describe('camp schema', () => {
  it('creates every table from the migrations', async () => {
    const db = await createTestDb();
    for (const table of [
      persons, personAliases, seasons, memberships, dues,
      payments, campEvents, tasks, taskAssignments,
    ]) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });

  it('keeps one due per person per season', async () => {
    const db = await createTestDb();
    const [person] = await db.insert(persons)
      .values({ displayName: 'אופק' }).returning();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 25', year: 2025, flatRate: '1500.00' }).returning();

    await db.insert(dues)
      .values({ personId: person.id, seasonId: season.id, amount: '1500.00' });

    await expect(
      db.insert(dues)
        .values({ personId: person.id, seasonId: season.id, amount: '1200.00' }),
    ).rejects.toThrow();
  });

  it('lets two people share a normalized alias', async () => {
    const db = await createTestDb();
    const [a] = await db.insert(persons).values({ displayName: 'אופק כהן' }).returning();
    const [b] = await db.insert(persons).values({ displayName: 'אופק לוי' }).returning();

    await db.insert(personAliases)
      .values({ personId: a.id, alias: 'אופק', normalized: 'אופק', source: 'manual' });
    // Two real people may share a first name. The schema must not force a merge.
    await expect(
      db.insert(personAliases)
        .values({ personId: b.id, alias: 'אופק', normalized: 'אופק', source: 'manual' }),
    ).resolves.toBeDefined();
  });

  it('offers the six observed payment channels', () => {
    expect(PAYMENT_CHANNELS).toContain('קיזוז');
    expect(PAYMENT_CHANNELS).toHaveLength(6);
  });
});
