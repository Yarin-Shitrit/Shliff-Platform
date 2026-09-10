import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, personAliases } from '@/db/schema/camp';
import {
  resolveName, recordUnlinkedName, listUnlinkedNames,
} from '@/lib/members/identity';

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
