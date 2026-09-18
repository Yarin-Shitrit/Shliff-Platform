import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases } from '@/db/schema/camp';
import {
  resolveName, recordUnlinkedName, listUnlinkedNames,
  ignoreName, unignoreName, listIgnoredNames,
} from '@/lib/members/identity';
import { createPerson, linkAlias, unlinkAlias } from '@/lib/members/link';
import { isHebrewRefusal } from '@/lib/errors/hebrew';

describe('resolveName', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  async function personWithAlias(displayName: string, alias: string) {
    const [row] = await db.insert(persons).values({ displayName }).returning();
    await db.insert(personAliases).values({
      personId: row.id, alias, normalized: alias, source: 'manual',
    });
    return row;
  }

  it('resolves a single exact match', async () => {
    const ofek = await personWithAlias('אופק', 'אופק');
    const result = await resolveName(db, 'אופק');
    expect(result.personId).toBe(ofek.id);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exact).toBe(true);
  });

  it('normalizes punctuation and padding before matching', async () => {
    const person = await personWithAlias('רן', 'רן');
    // Padding, an NBSP and a directional mark must not defeat the match.
    expect((await resolveName(db, '  רן‏ ')).personId).toBe(person.id);
  });

  it('refuses to pick when two people share a name', async () => {
    await personWithAlias('אופק כהן', 'אופק');
    await personWithAlias('אופק לוי', 'אופק');

    const result = await resolveName(db, 'אופק');
    expect(result.personId).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.exact)).toBe(true);
  });

  it('offers a partial match as a candidate but does not resolve it', async () => {
    await personWithAlias('אופק', 'אופק');

    const result = await resolveName(db, 'אופק כהן');
    expect(result.personId).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].exact).toBe(false);
  });

  /**
   * Hebrew has no regex word boundary, and naive substring matching is what
   * bit the Phase 1 classifier (`ביט` inside `ביטים`, `בר` inside `ברגים`).
   * Both pairs below are real: all four names appear in the workbooks.
   */
  it('does not match a name that is merely a substring of another', async () => {
    await personWithAlias('נטלי', 'נטלי');
    await personWithAlias('עמירם דהן', 'עמירם דהן');

    // טלי is inside נטלי; עמי is inside עמירם. Neither is a match.
    expect(await resolveName(db, 'טלי')).toMatchObject({
      personId: null, candidates: [],
    });
    expect(await resolveName(db, 'עמי')).toMatchObject({
      personId: null, candidates: [],
    });
  });

  it('returns nothing at all for an unknown name', async () => {
    await personWithAlias('יוסף', 'יוסף');
    const result = await resolveName(db, 'עמירם דהן');
    expect(result.personId).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.normalized).toBe('עמירם דהן');
  });

  /**
   * `resolveName` filters on `isNull(persons.mergedIntoId)`. Without this test
   * nothing would catch that filter being dropped or the join being flipped,
   * and a person folded into someone else would start answering to their old
   * name again — quietly re-splitting an identity a lead had already merged.
   */
  it('ignores a person who was merged into someone else', async () => {
    const survivor = await personWithAlias('אופק', 'אופק');
    // A name that shares no prefix with the survivor, so the only thing that
    // could make it resolve is the merged-away row itself.
    const folded = await personWithAlias('עמירם דהן', 'עמירם דהן');
    await db.update(persons)
      .set({ mergedIntoId: survivor.id })
      .where(eq(persons.id, folded.id));

    const result = await resolveName(db, 'עמירם דהן');
    expect(result.personId).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('ignores aliases that are not linked to anyone', async () => {
    await recordUnlinkedName(db, 'אופק', 'import');
    const result = await resolveName(db, 'אופק');
    expect(result.personId).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});

describe('unlinked names', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('records a name with no person and lists it', async () => {
    await recordUnlinkedName(db, 'עמירם דהן', 'import');
    const queue = await listUnlinkedNames(db);
    expect(queue).toHaveLength(1);
    expect(queue[0].alias).toBe('עמירם דהן');
    expect(queue[0].normalized).toBe('עמירם דהן');
  });

  it('does not queue the same name twice', async () => {
    await recordUnlinkedName(db, 'עמירם דהן', 'import');
    await recordUnlinkedName(db, ' עמירם דהן ', 'import');
    expect(await listUnlinkedNames(db)).toHaveLength(1);
  });
});

describe('ignoring a name', () => {
  it('is unreachable by any existing writer, which is what makes the state free', async () => {
    const db = await createTestDb();
    const personId = await createPerson(db, 'נועה לוי', 'lead@shliff.test');
    const aliasId = await recordUnlinkedName(db, 'נועה ל.', 'import');
    await linkAlias(db, aliasId, personId, 'lead@shliff.test');
    await unlinkAlias(db, aliasId);

    const rows = await db.select().from(personAliases);
    const stray = rows.filter((r) => r.personId === null && r.confirmedBy !== null);
    expect(stray).toEqual([]);
  });

  it('takes the name out of the queue and records who set it aside', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'סה"כ', 'import');
    await ignoreName(db, aliasId, 'lead@shliff.test');

    expect(await listUnlinkedNames(db)).toEqual([]);
    const [ignored] = await listIgnoredNames(db);
    expect(ignored.alias).toBe('סה"כ');
    expect(ignored.ignoredBy).toBe('lead@shliff.test');
    expect(ignored.ignoredAt).toBeInstanceOf(Date);
  });

  it('returns an ignored name to the queue, with no author left claiming it', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'סה"כ', 'import');
    await ignoreName(db, aliasId, 'lead@shliff.test');
    await unignoreName(db, aliasId);

    const [queued] = await listUnlinkedNames(db);
    expect(queued.alias).toBe('סה"כ');
    expect(queued.ignoredBy).toBeNull();
    expect(await listIgnoredNames(db)).toEqual([]);
  });

  it('survives re-promotion: recordUnlinkedName finds the ignored row rather than queueing a second', async () => {
    const db = await createTestDb();
    const aliasId = await recordUnlinkedName(db, 'סה"כ', 'import');
    await ignoreName(db, aliasId, 'lead@shliff.test');

    const again = await recordUnlinkedName(db, 'סה"כ', 'import');
    expect(again).toBe(aliasId);
    expect(await listUnlinkedNames(db)).toEqual([]);
  });

  it('refuses to ignore a name that is already linked to a person', async () => {
    const db = await createTestDb();
    const personId = await createPerson(db, 'נועה לוי', 'lead@shliff.test');
    const aliasId = await recordUnlinkedName(db, 'נועה ל.', 'import');
    await linkAlias(db, aliasId, personId, 'lead@shliff.test');

    await expect(ignoreName(db, aliasId, 'lead@shliff.test'))
      .rejects.toThrow('כינוי שמשויך לאדם — יש לנתק אותו לפני שמסמנים אותו כלא-אדם');
  });

  // A20: the refusal says it is one, rather than being guessed at by alphabet.
  // Without the marker it survives only because it happens to carry no Latin
  // letter, and the first interpolated id or account name would silently
  // replace it with the generic fallback.
  it('marks its refusal as Hebrew rather than leaving it to be sniffed', async () => {
    const db = await createTestDb();
    const personId = await createPerson(db, 'נועה לוי', 'lead@shliff.test');
    const aliasId = await recordUnlinkedName(db, 'נועה ל.', 'import');
    await linkAlias(db, aliasId, personId, 'lead@shliff.test');

    await expect(ignoreName(db, aliasId, 'lead@shliff.test'))
      .rejects.toSatisfy(isHebrewRefusal);
  });
});
