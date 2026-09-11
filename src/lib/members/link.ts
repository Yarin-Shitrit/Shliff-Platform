import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, dues, taskAssignments,
} from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';

export type MergeResult =
  | { ok: true; movedAliases: number }
  | { ok: false; conflicts: string[] };

/** Creates a person and their first alias together, so a new person is
 *  immediately findable by `resolveName`. */
export async function createPerson(
  db: AnyDb, displayName: string, email: string,
): Promise<string> {
  /*
   * Store the spelling as given; normalize only for comparison.
   *
   * normalizeHebrew maps the geresh ׳ (U+05F3) to an ASCII apostrophe, so
   * storing its output made `ראנצ׳ו` become `ראנצ'ו` — a spelling that appears
   * in none of the camp's sheets, displayed back to the lead who typed the
   * real one. The alias table exists precisely to keep the written form as
   * evidence and the normalized form as the lookup key; collapsing them here
   * defeated it at the moment a person is created.
   */
  const name = displayName.trim();
  const [person] = await db.insert(persons).values({ displayName: name }).returning();
  await db.insert(personAliases).values({
    personId: person.id,
    alias: name,
    normalized: normalizeHebrew(name),
    source: 'manual',
    confirmedBy: email,
    confirmedAt: new Date(),
  });
  return person.id;
}

/** Promotes a queued unlinked name into a person of its own. */
export async function createPersonFromAlias(
  db: AnyDb, aliasId: string, email: string,
): Promise<string> {
  const [alias] = await db.select().from(personAliases)
    .where(eq(personAliases.id, aliasId));
  if (!alias) throw new Error(`unknown alias ${aliasId}`);
  if (alias.personId) throw new Error(`alias ${aliasId} is already linked`);

  const [person] = await db.insert(persons)
    .values({ displayName: alias.alias }).returning();
  await db.update(personAliases)
    .set({ personId: person.id, confirmedBy: email, confirmedAt: new Date() })
    .where(eq(personAliases.id, aliasId));
  return person.id;
}

/** Attaches a queued name to an existing person. Stamps who decided and when:
 *  identity decisions are never anonymous. */
export async function linkAlias(
  db: AnyDb, aliasId: string, personId: string, email: string,
): Promise<void> {
  await db.update(personAliases)
    .set({ personId, confirmedBy: email, confirmedAt: new Date() })
    .where(eq(personAliases.id, aliasId));
}

/** Detaches an alias, putting it back in the leads' queue and clearing the
 *  previous confirmation so the row does not claim an approval it no longer has. */
export async function unlinkAlias(db: AnyDb, aliasId: string): Promise<void> {
  await db.update(personAliases)
    .set({ personId: null, confirmedBy: null, confirmedAt: null })
    .where(eq(personAliases.id, aliasId));
}

/**
 * Folds `sourceId` into `targetId`.
 *
 * Permitted only when the source carries nothing but aliases. Moving a due or
 * a membership could silently combine two people's money, and refusing keeps
 * the merge exactly reversible from `merged_from_person_id` without an audit
 * table. Callers get the blockers back so a lead can resolve them by hand.
 *
 * Two further refusals exist to keep that reversibility claim honest rather
 * than merely plausible — see the comments on each below.
 */
export async function mergePersons(
  db: AnyDb, sourceId: string, targetId: string, email: string,
): Promise<MergeResult> {
  if (sourceId === targetId) return { ok: false, conflicts: ['אותו אדם'] };

  const conflicts: string[] = [];
  const [membership] = await db.select().from(memberships)
    .where(eq(memberships.personId, sourceId)).limit(1);
  if (membership) conflicts.push('חברות במחנה');

  const [due] = await db.select().from(dues)
    .where(eq(dues.personId, sourceId)).limit(1);
  if (due) conflicts.push('דמי קאמפ');

  const [assignment] = await db.select().from(taskAssignments)
    .where(eq(taskAssignments.personId, sourceId)).limit(1);
  if (assignment) conflicts.push('שיבוץ למשימה');

  /*
   * Refuse to merge a person who has themselves absorbed someone.
   *
   * `merged_from_person_id` holds one origin per alias, so it can record one
   * level of merge, not a chain. Merging X into A and then A into B would
   * restamp X's alias with A and destroy the only pointer back to X, leaving
   * `unmergePerson(X)` to match nothing and silently do nothing. Rather than
   * grow an audit table for a case a camp of this size hits once a year, the
   * chain is refused: unmerge X first, then merge A into B.
   */
  const [absorbed] = await db.select().from(persons)
    .where(eq(persons.mergedIntoId, sourceId)).limit(1);
  if (absorbed) conflicts.push('מיזוג קודם');

  /*
   * Refuse when both people own the same spelling.
   *
   * `person_aliases` is unique on (person_id, normalized) but deliberately NOT
   * on `normalized` alone, because two real people may share a Hebrew first
   * name. That makes this collision reachable, and moving the source's alias
   * onto the target would violate the constraint and throw a raw database
   * error instead of a MergeResult a lead can read.
   */
  const sourceAliases = await db.select({ normalized: personAliases.normalized })
    .from(personAliases).where(eq(personAliases.personId, sourceId));
  const targetAliases = await db.select({ normalized: personAliases.normalized })
    .from(personAliases).where(eq(personAliases.personId, targetId));
  const targetSet = new Set(targetAliases.map((row) => row.normalized));
  if (sourceAliases.some((row) => targetSet.has(row.normalized))) {
    conflicts.push('כינוי זהה קיים');
  }

  if (conflicts.length > 0) return { ok: false, conflicts };

  const moved = await db.update(personAliases)
    .set({
      personId: targetId,
      mergedFromPersonId: sourceId,
      confirmedBy: email,
      confirmedAt: new Date(),
    })
    .where(eq(personAliases.personId, sourceId))
    .returning();

  await db.update(persons)
    .set({ mergedIntoId: targetId })
    .where(eq(persons.id, sourceId));

  return { ok: true, movedAliases: moved.length };
}

/** Reverses a merge exactly: every alias goes back to the person it came from. */
export async function unmergePerson(db: AnyDb, sourceId: string): Promise<void> {
  await db.update(personAliases)
    .set({ personId: sourceId, mergedFromPersonId: null })
    .where(eq(personAliases.mergedFromPersonId, sourceId));

  await db.update(persons)
    .set({ mergedIntoId: null })
    .where(eq(persons.id, sourceId));
}
