import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import {
  persons, personAliases, seasons, memberships, dues, payments, tasks, taskAssignments,
} from '@/db/schema/camp';
import {
  recordUnlinkedName, resolveName, listUnlinkedNames, listIgnoredNames,
} from '@/lib/members/identity';
import {
  createPerson, createPersonFromAlias, linkAlias, unlinkAlias,
  mergePersons, unmergePerson, mergeConflicts, previewMerge, aliasUnlinkTarget,
  splitAlias,
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

  /**
   * normalizeHebrew maps the geresh ׳ (U+05F3) to an ASCII apostrophe. Storing
   * its output rewrote `ראנצ׳ו` into a spelling found in no sheet and showed it
   * back to the lead who typed the real one. The written form is evidence; the
   * normalized form is only the lookup key.
   */
  it('stores the spelling as typed, and normalizes only for lookup', async () => {
    const id = await createPerson(db, 'ראנצ׳ו', LEAD);

    const [person] = await db.select().from(persons).where(eq(persons.id, id));
    expect(person.displayName).toBe('ראנצ׳ו');

    const [alias] = await db.select().from(personAliases)
      .where(eq(personAliases.personId, id));
    expect(alias.alias).toBe('ראנצ׳ו');
    expect(alias.normalized).toBe("ראנצ'ו");

    // Both spellings still find them — that is what normalizing the key buys.
    expect((await resolveName(db, 'ראנצ׳ו')).personId).toBe(id);
    expect((await resolveName(db, "ראנצ'ו")).personId).toBe(id);
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

/**
 * The screen must never offer a merge the library would refuse, and never
 * describe a move the library would not make. The only way to guarantee that
 * is for one piece of code to decide — so the refusal logic lives here and
 * `mergePersons` calls it. These tests exist to prove the extraction changed
 * nothing: every string, and their order, is the same as before.
 */
describe('mergeConflicts', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('finds nothing wrong with two people who carry only their names', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    expect(await mergeConflicts(db, source, target)).toEqual([]);
  });

  it('refuses the same person as both sides, and says nothing else about them', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    expect(await mergeConflicts(db, person, person)).toEqual(['אותו אדם']);
  });

  it('names a membership, a due and an assignment in the order a lead reads them', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    await db.insert(memberships).values({ personId: source, seasonId: season.id });
    await db.insert(dues)
      .values({ personId: source, seasonId: season.id, amount: '1200.00' });
    const [task] = await db.insert(tasks)
      .values({ seasonId: season.id, kind: 'build', title: 'הקמת הצל', peopleNeeded: 1 })
      .returning();
    await db.insert(taskAssignments)
      .values({ taskId: task.id, personId: source, assignedBy: LEAD });

    expect(await mergeConflicts(db, source, target))
      .toEqual(['חברות במחנה', 'דמי קאמפ', 'שיבוץ למשימה']);
  });

  it('refuses a source that has itself absorbed somebody', async () => {
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    const earlier = await createPerson(db, 'א. כהן', LEAD);
    expect((await mergePersons(db, earlier, source, LEAD)).ok).toBe(true);

    expect(await mergeConflicts(db, source, target)).toEqual(['מיזוג קודם']);
  });

  it('refuses when both people already own the same spelling', async () => {
    const target = await createPerson(db, 'דניאל', LEAD);
    const source = await createPerson(db, 'דניאל פינטו', LEAD);
    await db.insert(personAliases).values({
      personId: source, alias: 'דניאל', normalized: 'דניאל', source: 'manual',
    });

    expect(await mergeConflicts(db, source, target)).toEqual(['כינוי זהה קיים']);
  });
});

describe('previewMerge', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('answers null when either id names nobody', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await previewMerge(db, ghost, person)).toBeNull();
    expect(await previewMerge(db, person, ghost)).toBeNull();
  });

  /*
   * `persons.id` is a uuid column, so Postgres throws on a malformed one
   * rather than matching no rows. A merge URL is meant to be pasted, and a
   * truncated one would otherwise crash the screen with a database error.
   */
  it('answers null for an id that is not even shaped like one', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    expect(await previewMerge(db, 'no-such-person', person)).toBeNull();
    expect(await previewMerge(db, person, 'not-a-uuid')).toBeNull();
  });

  it('lists exactly what a permitted merge would move, which is aliases and nothing else', async () => {
    const target = await createPerson(db, 'אופק כהן', LEAD);
    const source = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'Ofek', 'import');
    await linkAlias(db, aliasId, source, LEAD);

    const preview = await previewMerge(db, source, target);
    expect(preview).not.toBeNull();
    expect(preview!.conflicts).toEqual([]);
    expect(preview!.blockers).toEqual([]);
    expect([...preview!.movingAliases].sort()).toEqual(['Ofek', 'אופק']);
    expect(preview!.source.displayName).toBe('אופק');
    expect(preview!.target.displayName).toBe('אופק כהן');
  });

  /*
   * The preview and the merge must agree by construction: `previewMerge` calls
   * `mergeConflicts`, which is what `mergePersons` calls. A second copy of the
   * rules would be a promise the merge might not keep.
   */
  it('reports every blocker with its count while still saying what would have moved', async () => {
    const target = await createPerson(db, 'אופק כהן', LEAD);
    const source = await createPerson(db, 'אופק', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    await db.insert(memberships).values({ personId: source, seasonId: season.id });
    const [due] = await db.insert(dues)
      .values({ personId: source, seasonId: season.id, amount: '1200.00' }).returning();
    await db.insert(payments).values({
      dueId: due.id, amount: '500.00', channel: 'ביט',
      paidOn: new Date('2026-08-28'), recordedBy: LEAD,
    });
    const [task] = await db.insert(tasks)
      .values({ seasonId: season.id, kind: 'build', title: 'הקמת הצל', peopleNeeded: 1 })
      .returning();
    await db.insert(taskAssignments)
      .values({ taskId: task.id, personId: source, assignedBy: LEAD });

    const preview = (await previewMerge(db, source, target))!;

    expect(preview.conflicts).toEqual(['חברות במחנה', 'דמי קאמפ', 'שיבוץ למשימה']);
    expect(preview.blockers.map((b) => [b.conflict, b.count])).toEqual([
      ['חברות במחנה', 1], ['דמי קאמפ', 1], ['שיבוץ למשימה', 1],
    ]);
    expect(preview.blockers[0].href).toBe(`/members/${source}`);
    expect(preview.blockers[1].href).toBe(`/members/${source}?tab=payments`);
    expect(preview.blockers[2].href).toBe(`/members/${source}?tab=tasks`);
    // Still says what it would move — the refusals are the reason it cannot.
    expect(preview.movingAliases).toEqual(['אופק']);
  });

  it('carries each side its own aliases, seasons, counts and balance', async () => {
    const target = await createPerson(db, 'אופק כהן', LEAD);
    const source = await createPerson(db, 'אופק', LEAD);
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00' }).returning();
    await db.insert(memberships).values({ personId: target, seasonId: season.id });
    const [due] = await db.insert(dues)
      .values({ personId: target, seasonId: season.id, amount: '1200.00' }).returning();
    await db.insert(payments).values({
      dueId: due.id, amount: '500.00', channel: 'ביט',
      paidOn: new Date('2026-08-28'), recordedBy: LEAD,
    });

    const preview = (await previewMerge(db, source, target))!;

    expect(preview.target.seasons).toEqual(['ברן 26']);
    expect(preview.target.duesCount).toBe(1);
    expect(preview.target.paymentsCount).toBe(1);
    expect(preview.target.assignmentsCount).toBe(0);
    expect(preview.target.outstandingAgorot).toBe(70000);
    expect(preview.source.seasons).toEqual([]);
    expect(preview.source.outstandingAgorot).toBe(0);
    expect(preview.source.aliases).toEqual(['אופק']);
  });

  /* `אותו אדם` and `מיזוג קודם` have nowhere to send a lead: one is not a row
     to unpick and the other needs an unmerge that no screen offers. */
  it('gives a blocker with nowhere to go a null href rather than a dead link', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    const preview = (await previewMerge(db, person, person))!;
    expect(preview.blockers).toEqual([{ conflict: 'אותו אדם', count: 1, href: null }]);
  });
});

describe('aliasUnlinkTarget', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  /* A person created from nothing has exactly one spelling — their own name —
     so `remaining` is zero and the action refuses. */
  it('reports nothing left when a person has only their own name', async () => {
    const person = await createPerson(db, 'אופק', LEAD);
    const [alias] = await db.select().from(personAliases)
      .where(eq(personAliases.personId, person));
    expect(await aliasUnlinkTarget(db, alias.id))
      .toEqual({ personId: person, remaining: 0 });
  });

  it('counts the other spellings, not this one', async () => {
    const person = await createPerson(db, 'רוני אדלר', LEAD);
    await linkAlias(db, await recordUnlinkedName(db, 'Roni A.', 'import'), person, LEAD);
    await linkAlias(db, await recordUnlinkedName(db, 'רוני', 'import'), person, LEAD);
    const [alias] = await db.select().from(personAliases)
      .where(eq(personAliases.alias, 'רוני'));
    expect(await aliasUnlinkTarget(db, alias.id))
      .toEqual({ personId: person, remaining: 2 });
  });

  it('answers null for an alias that names nothing, malformed id included', async () => {
    expect(await aliasUnlinkTarget(db, 'not-a-uuid')).toBeNull();
    expect(await aliasUnlinkTarget(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('splitAlias', () => {
  it('queues each part and sets the original aside, attributed', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'רוני ו-גיל', 'import');

    const { aliasIds } = await splitAlias(db, aliasId, ['רוני', 'גיל'], 'lead@shliff.test');

    expect(aliasIds).toHaveLength(2);
    expect((await listUnlinkedNames(db)).map((n) => n.alias).sort())
      .toEqual(['גיל', 'רוני']);
    const [original] = await listIgnoredNames(db);
    expect(original.alias).toBe('רוני ו-גיל');
    expect(original.ignoredBy).toBe('lead@shliff.test');
  });

  it('refuses fewer than two parts, so a split cannot quietly become a rename', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'רוני ו-גיל', 'import');
    await expect(splitAlias(db, aliasId, ['רוני'], 'lead@shliff.test'))
      .rejects.toThrow('פיצול דורש שני שמות לפחות');
  });

  it('refuses a blank part rather than queueing an empty name', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'רוני ו-גיל', 'import');
    await expect(splitAlias(db, aliasId, ['רוני', '‏ ‎'], 'lead@shliff.test'))
      .rejects.toThrow('שם ריק');
  });

  // Ruling 8b, pinned: the split queues names, it does not move money. A test
  // that only counted the new aliases would pass just as happily against an
  // implementation that rewrote the promoted rows underneath a lead.
  it('leaves the original name queued for nothing and writes no person', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'רוני ו-גיל', 'import');
    await splitAlias(db, aliasId, ['רוני', 'גיל'], 'lead@shliff.test');
    expect(await db.select().from(persons)).toEqual([]);
  });
});
