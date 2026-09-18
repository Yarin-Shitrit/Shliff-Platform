import { eq } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  persons, personAliases, memberships, dues, payments, seasons, taskAssignments,
} from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';
import { toAgorot } from '@/lib/money';

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
 * Everything that would stop `sourceId` folding into `targetId`, in the order
 * a lead reads them.
 *
 * Extracted so the merge screen can show the refusals *before* the button is
 * pressed and be certain it is showing the real ones. A preview computed by a
 * second copy of this logic would be a promise the merge might not keep.
 *
 * Behaviour is unchanged by the extraction: the same six strings, in the same
 * order, decided by the same reads. `mergePersons` now calls this.
 */
export async function mergeConflicts(
  db: AnyDb, sourceId: string, targetId: string,
): Promise<string[]> {
  if (sourceId === targetId) return ['אותו אדם'];

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

  return conflicts;
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
  const conflicts = await mergeConflicts(db, sourceId, targetId);
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

export interface MergeBlocker {
  /** The refusal word, verbatim from `mergeConflicts`. */
  conflict: string;
  /** How many rows cause it. */
  count: number;
  /** Where a lead goes to unpick it, or null when there is nowhere to go. */
  href: string | null;
}

export interface MergeSide {
  personId: string;
  displayName: string;
  aliases: string[];
  seasons: string[];
  duesCount: number;
  paymentsCount: number;
  assignmentsCount: number;
  outstandingAgorot: number;
}

export interface MergePreview {
  source: MergeSide;
  target: MergeSide;
  /** Exactly what a permitted merge would move. Today: aliases, and nothing
   *  else — which is the whole reason the other five refusals exist. */
  movingAliases: string[];
  /** Identical, by construction, to what `mergePersons` would refuse on. */
  conflicts: string[];
  blockers: MergeBlocker[];
}

/**
 * `persons.id` is a uuid column, so a malformed id does not come back as "no
 * rows" — Postgres refuses the comparison and throws
 * `invalid input syntax for type uuid`. A merge URL is meant to be pasted, and
 * a truncated one out of a chat would otherwise crash the screen with a raw
 * database error instead of rendering nothing. Checked here rather than at the
 * page, because a second caller would not have the check.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sideOf(db: AnyDb, personId: string): Promise<MergeSide | null> {
  if (!UUID.test(personId)) return null;

  const [person] = await db.select().from(persons).where(eq(persons.id, personId));
  if (!person) return null;

  const aliasRows = await db.select({ alias: personAliases.alias })
    .from(personAliases).where(eq(personAliases.personId, personId));

  const seasonRows = await db
    .select({ name: seasons.name, year: seasons.year })
    .from(memberships)
    .innerJoin(seasons, eq(seasons.id, memberships.seasonId))
    .where(eq(memberships.personId, personId));

  const dueRows = await db.select({ id: dues.id, amount: dues.amount })
    .from(dues).where(eq(dues.personId, personId));

  let paymentsCount = 0;
  let outstandingAgorot = 0;
  for (const due of dueRows) {
    const paymentRows = await db.select({ amount: payments.amount })
      .from(payments).where(eq(payments.dueId, due.id));
    paymentsCount += paymentRows.length;
    const paid = paymentRows.reduce((total, row) => total + toAgorot(row.amount), 0);
    outstandingAgorot += Math.max(0, toAgorot(due.amount) - paid);
  }

  const assignmentRows = await db.select({ id: taskAssignments.id })
    .from(taskAssignments).where(eq(taskAssignments.personId, personId));

  return {
    personId,
    displayName: person.displayName,
    aliases: aliasRows.map((row) => row.alias).sort(),
    seasons: seasonRows.sort((a, b) => a.year - b.year).map((row) => row.name),
    duesCount: dueRows.length,
    paymentsCount,
    assignmentsCount: assignmentRows.length,
    outstandingAgorot,
  };
}

/**
 * What a merge would do, and everything standing in its way, before anything
 * is pressed.
 *
 * The refusal list comes from `mergeConflicts` — the same call `mergePersons`
 * makes — so the screen cannot promise a merge the library would refuse, and
 * cannot describe a move it would not make. The counts and the hrefs are the
 * only thing this adds: a lead who is told `דמי קאמפ` needs to know it is one
 * due and where to go and look at it.
 *
 * `movingAliases` is reported even when the merge is blocked. The refusals are
 * the reason it cannot happen, not a reason to hide what it was going to be.
 *
 * Null when either id names nobody: a merge URL is pasteable, so a stale id in
 * one is an ordinary thing rather than an error.
 */
export async function previewMerge(
  db: AnyDb, sourceId: string, targetId: string,
): Promise<MergePreview | null> {
  const source = await sideOf(db, sourceId);
  const target = sourceId === targetId ? source : await sideOf(db, targetId);
  if (!source || !target) return null;

  const conflicts = await mergeConflicts(db, sourceId, targetId);

  const sharedAliases = new Set(
    (await db.select({ normalized: personAliases.normalized })
      .from(personAliases).where(eq(personAliases.personId, targetId)))
      .map((row) => row.normalized),
  );
  const shared = sourceId === targetId ? 0 : (
    await db.select({ normalized: personAliases.normalized })
      .from(personAliases).where(eq(personAliases.personId, sourceId))
  ).filter((row) => sharedAliases.has(row.normalized)).length;

  const absorbedRows = await db.select({ id: persons.id })
    .from(persons).where(eq(persons.mergedIntoId, sourceId));

  /*
   * `אותו אדם` and `מיזוג קודם` get no href on purpose. The first is not a row
   * to unpick, and the second needs an unmerge that no screen offers — see the
   * note above `unmergePerson`. A link that went somewhere useless would be
   * worse than none, because it would imply there is a fix one click away.
   */
  const COUNTS: Record<string, { count: number; href: string | null }> = {
    'אותו אדם': { count: 1, href: null },
    'חברות במחנה': { count: source.seasons.length, href: `/members/${sourceId}` },
    'דמי קאמפ': { count: source.duesCount, href: `/members/${sourceId}?tab=payments` },
    'שיבוץ למשימה': { count: source.assignmentsCount, href: `/members/${sourceId}?tab=tasks` },
    'מיזוג קודם': { count: absorbedRows.length, href: null },
    'כינוי זהה קיים': { count: shared, href: `/members/${targetId}?tab=aliases` },
  };

  return {
    source,
    target,
    movingAliases: source.aliases,
    conflicts,
    blockers: conflicts.map((conflict) => ({
      conflict,
      count: COUNTS[conflict]?.count ?? 0,
      href: COUNTS[conflict]?.href ?? null,
    })),
  };
}
