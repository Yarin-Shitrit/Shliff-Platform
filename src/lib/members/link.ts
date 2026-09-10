import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, dues, taskAssignments,
} from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';

export type MergeResult =
  | { ok: true; movedAliases: number }
  | { ok: false; conflicts: string[] };

export async function createPerson(
  db: AnyDb, displayName: string, email: string,
): Promise<string> {
  const name = normalizeHebrew(displayName);
  const [person] = await db.insert(persons).values({ displayName: name }).returning();
  await db.insert(personAliases).values({
    personId: person.id,
    alias: name,
    normalized: name,
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

export async function linkAlias(
  db: AnyDb, aliasId: string, personId: string, email: string,
): Promise<void> {
  await db.update(personAliases)
    .set({ personId, confirmedBy: email, confirmedAt: new Date() })
    .where(eq(personAliases.id, aliasId));
}

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
