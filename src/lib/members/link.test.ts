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

  it('refuses to promote an alias that is already linked', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);

    await expect(createPersonFromAlias(db, aliasId, LEAD))
      .rejects.toThrow(/already linked/);
  });

  it('clears the confirmation stamp when an alias is unlinked', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);
    await unlinkAlias(db, aliasId);

    const [alias] = await db.select().from(personAliases)
      .where(eq(personAliases.id, aliasId));
    expect(alias.confirmedBy).toBeNull();
    expect(alias.confirmedAt).toBeNull();
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

  /**
   * `merged_from_person_id` records one origin per alias, not a chain. Merging
   * X into A and then A into B would restamp X's alias with A and destroy the
   * only pointer back to X — `unmergePerson(X)` would then match nothing and
   * silently do nothing, while the UI reported a successful unmerge. The chain
   * is refused so the reversibility claim stays true.
   */
  it('refuses to merge a person who has themselves absorbed someone', async () => {
    const x = await createPerson(db, 'אופק כהן', LEAD);
    const a = await createPerson(db, 'אופק', LEAD);
    const b = await createPerson(db, 'אופק לוי', LEAD);
    expect((await mergePersons(db, x, a, LEAD)).ok).toBe(true);

    const chained = await mergePersons(db, a, b, LEAD);
    expect(chained.ok).toBe(false);
    if (!chained.ok) expect(chained.conflicts).toContain('מיזוג קודם');

    // X is still recoverable, which is the whole point of refusing.
    await unmergePerson(db, x);
    expect((await resolveName(db, 'אופק כהן')).personId).toBe(x);
  });

  /**
   * The schema is unique on (person_id, normalized), NOT on normalized alone —
   * two real people may share a Hebrew first name. That makes this collision
   * reachable, and moving the alias would throw a raw database error instead
   * of a MergeResult a lead can read.
   */
  it('refuses when both people already own the same spelling', async () => {
    const target = await createPerson(db, 'דניאל', LEAD);
    const source = await createPerson(db, 'דניאל פינטו', LEAD);
    const aliasId = await recordUnlinkedName(db, 'דניאל', 'import');
    await unlinkAlias(db, aliasId);
    // Give the source an alias the target already owns.
    await db.insert(personAliases).values({
      personId: source, alias: 'דניאל', normalized: 'דניאל', source: 'manual',
    });

    const result = await mergePersons(db, source, target, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts).toContain('כינוי זהה קיים');
    // Nothing moved.
    expect((await resolveName(db, 'דניאל פינטו')).personId).toBe(source);
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
