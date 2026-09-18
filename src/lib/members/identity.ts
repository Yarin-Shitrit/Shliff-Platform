import { and, asc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { persons, personAliases } from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';
import { HebrewRefusal } from '@/lib/errors/hebrew';

export interface NameCandidate {
  personId: string;
  displayName: string;
  /** The stored alias that matched. */
  alias: string;
  /** True when the normalized forms are identical, false for a partial match. */
  exact: boolean;
}

export interface NameResolution {
  normalized: string;
  /**
   * Set only when exactly one alias matched exactly. `null` for every other
   * outcome — several exact matches, a partial match, or nothing at all.
   * A caller that wants a person for a `null` resolution must ask a lead.
   */
  personId: string | null;
  candidates: NameCandidate[];
}

export interface UnlinkedName {
  aliasId: string;
  alias: string;
  normalized: string;
  source: string;
  /** Who set this name aside as "not a person", and when. Null while it is
   *  still queued for a decision. */
  ignoredBy: string | null;
  ignoredAt: Date | null;
}

/**
 * Looks a name up against every linked alias.
 *
 * Deliberately conservative: merging two people's dues, debts and ownerships
 * is not reversible from the UI, so this never picks between candidates. It
 * reports what it saw and leaves the decision to a lead.
 */
export async function resolveName(db: AnyDb, rawName: string): Promise<NameResolution> {
  const normalized = normalizeHebrew(rawName);
  if (!normalized) return { normalized, personId: null, candidates: [] };

  const linked = await db
    .select({
      personId: personAliases.personId,
      displayName: persons.displayName,
      alias: personAliases.alias,
      normalized: personAliases.normalized,
    })
    .from(personAliases)
    .innerJoin(persons, eq(persons.id, personAliases.personId))
    .where(and(isNotNull(personAliases.personId), isNull(persons.mergedIntoId)));

  const candidates: NameCandidate[] = [];
  for (const row of linked) {
    const exact = row.normalized === normalized;
    // Space-boundary anchored, not substring: Hebrew has no regex word
    // boundary, and naive `includes()` is exactly what bit the Phase 1
    // classifier (`ביט` matched inside `ביטים`). `טלי` is a real substring
    // of `נטלי`, and `עמי` of `עמירם דהן` — both are real members, and
    // neither may match the other.
    const partial = !exact
      && (row.normalized.startsWith(`${normalized} `)
        || normalized.startsWith(`${row.normalized} `));
    if (exact || partial) {
      candidates.push({
        personId: row.personId as string,
        displayName: row.displayName,
        alias: row.alias,
        exact,
      });
    }
  }

  const exactMatches = candidates.filter((c) => c.exact);
  const personId = exactMatches.length === 1 ? exactMatches[0].personId : null;
  return { normalized, personId, candidates };
}

/**
 * Stores a name that could not be attributed to a person. It sits in the
 * leads' queue until someone links it or promotes it to a new person.
 */
export async function recordUnlinkedName(
  db: AnyDb, rawName: string, source: 'import' | 'manual',
): Promise<string> {
  const normalized = normalizeHebrew(rawName);
  const [existing] = await db.select().from(personAliases).where(
    and(isNull(personAliases.personId), eq(personAliases.normalized, normalized)),
  );
  if (existing) return existing.id;

  // Store the spelling as it was seen, not the normalized form: `normalized`
  // exists for comparison, `alias` is the evidence. normalizeHebrew maps the
  // geresh ׳ to an ASCII apostrophe, so storing it here would silently rewrite
  // `ראנצ׳ו ונטלי` into a spelling that appears in no sheet.
  const [row] = await db.insert(personAliases)
    .values({ personId: null, alias: rawName.trim(), normalized, source })
    .returning();
  return row.id;
}

const UNLINKED_COLUMNS = {
  aliasId: personAliases.id,
  alias: personAliases.alias,
  normalized: personAliases.normalized,
  source: personAliases.source,
  ignoredBy: personAliases.confirmedBy,
  ignoredAt: personAliases.confirmedAt,
};

/**
 * Names still waiting for a decision.
 *
 * An alias with no person and a `confirmed_by` is not waiting: someone looked
 * at it and said it is not a person. That pair of columns is the whole storage
 * for the ignore state — every existing writer sets `person_id` whenever it
 * stamps `confirmed_by`, and `unlinkAlias` clears the two together, so the
 * combination is unreachable by anything else and needs no new column.
 * `identity.test.ts` pins that invariant.
 */
export async function listUnlinkedNames(db: AnyDb): Promise<UnlinkedName[]> {
  return db.select(UNLINKED_COLUMNS).from(personAliases)
    .where(and(isNull(personAliases.personId), isNull(personAliases.confirmedBy)))
    .orderBy(asc(personAliases.normalized));
}

/** Names a lead has set aside as not-a-person. Reversible, and attributed. */
export async function listIgnoredNames(db: AnyDb): Promise<UnlinkedName[]> {
  return db.select(UNLINKED_COLUMNS).from(personAliases)
    .where(and(isNull(personAliases.personId), isNotNull(personAliases.confirmedBy)))
    .orderBy(asc(personAliases.normalized));
}

/**
 * Sets a name aside as "not a person" — a `סה״כ` cell, a supplier, a column
 * header the block detector swept in.
 *
 * Camp-wide and attributed, unlike a snooze: the next lead should not be asked
 * the same question, and the decision names who made it. Reversible through
 * `unignoreName`, which is why the toast on this action offers undo.
 */
export async function ignoreName(db: AnyDb, aliasId: string, email: string): Promise<void> {
  const [alias] = await db.select({ personId: personAliases.personId })
    .from(personAliases).where(eq(personAliases.id, aliasId));
  if (!alias) throw new Error(`unknown alias ${aliasId}`);
  if (alias.personId !== null) {
    // A20: marked as a refusal rather than left to the alphabet passthrough.
    // The passthrough would serve this string correctly today only because it
    // happens to carry no Latin letter.
    throw new HebrewRefusal('כינוי שמשויך לאדם — יש לנתק אותו לפני שמסמנים אותו כלא-אדם');
  }
  await db.update(personAliases)
    .set({ confirmedBy: email, confirmedAt: new Date() })
    .where(eq(personAliases.id, aliasId));
}

/** Returns an ignored name to the queue, clearing the decision with it. */
export async function unignoreName(db: AnyDb, aliasId: string): Promise<void> {
  await db.update(personAliases)
    .set({ confirmedBy: null, confirmedAt: null })
    .where(eq(personAliases.id, aliasId));
}
