import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases, seasons, memberships, dues } from '@/db/schema/camp';
import { recordUnlinkedName, resolveName, listUnlinkedNames } from '@/lib/members/identity';
import {
  createPerson, createPersonFromAlias, linkAlias, unlinkAlias,
  mergePersons, unmergePerson,
} from '@/lib/members/link';

const LEAD = 'lead@shliff.camp';

describe('linking', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('creates a person and their first alias together', async () => {
    const id = await createPerson(db, 'אופק', LEAD);
    const resolution = await resolveName(db, 'אופק');
    expect(resolution.personId).toBe(id);
  });

  it('promotes an unlinked name to a new person and clears the queue', async () => {
    const aliasId = await recordUnlinkedName(db, 'עמירם דהן', 'import');
    const personId = await createPersonFromAlias(db, aliasId, LEAD);

    expect(await listUnlinkedNames(db)).toEqual([]);
    expect((await resolveName(db, 'עמירם דהן')).personId).toBe(personId);
    const [person] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(person.displayName).toBe('עמירם דהן');
  });

  it('links an unlinked name to an existing person and stamps who confirmed it', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);

    expect(await listUnlinkedNames(db)).toEqual([]);
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(ofek);
    const [alias] = await db.select().from(personAliases).where(eq(personAliases.id, aliasId));
    expect(alias.confirmedBy).toBe(LEAD);
    expect(alias.confirmedAt).toBeInstanceOf(Date);
  });

  it('unlinks an alias back into the queue', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);
    await unlinkAlias(db, aliasId);

    expect(await listUnlinkedNames(db)).toHaveLength(1);
    expect((await resolveName(db, 'אופק כהן')).personId).toBeNull();
  });
});

describe('merging', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('moves the source aliases onto the target and hides the source', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);

    const result = await mergePersons(db, source, target, LEAD);
    expect(result).toEqual({ ok: true, movedAliases: 1 });

    // Both spellings now reach one person, and the source no longer competes.
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(target);
    expect((await resolveName(db, 'אופק')).personId).toBe(target);
    const [merged] = await db.select().from(persons).where(eq(persons.id, source));
    expect(merged.mergedIntoId).toBe(target);
  });

  it('refuses to merge a person who has a due, and says why', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 25', year: 2025, flatRate: '1500.00' }).returning();
    await db.insert(dues)
      .values({ personId: source, seasonId: season.id, amount: '1500.00' });

    const result = await mergePersons(db, source, target, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts).toContain('דמי קאמפ');

    // Nothing moved.
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(source);
  });

  it('refuses to merge a person who is on a roster', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    await db.insert(memberships).values({ personId: source, seasonId: season.id });

    const result = await mergePersons(db, source, target, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts).toContain('חברות במחנה');
  });

  it('refuses to merge a person into themselves', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    const result = await mergePersons(db, person, person, LEAD);
    expect(result.ok).toBe(false);
  });

  it('unmerges exactly, putting every alias back where it came from', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    await mergePersons(db, source, target, LEAD);
    await unmergePerson(db, source);

    expect((await resolveName(db, 'אופק כהן')).personId).toBe(source);
    expect((await resolveName(db, 'אופק')).personId).toBe(target);
    const [restored] = await db.select().from(persons).where(eq(persons.id, source));
    expect(restored.mergedIntoId).toBeNull();
  });
});
