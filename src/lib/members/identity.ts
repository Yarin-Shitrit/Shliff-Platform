import { and, asc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { persons, personAliases } from '@/db/schema/camp';
import { normalizeHebrew } from '@/lib/text/normalize';

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

export async function listUnlinkedNames(db: AnyDb): Promise<UnlinkedName[]> {
  const rows = await db
    .select({
      aliasId: personAliases.id,
      alias: personAliases.alias,
      normalized: personAliases.normalized,
      source: personAliases.source,
    })
    .from(personAliases)
    .where(isNull(personAliases.personId))
    .orderBy(asc(personAliases.normalized));
  return rows;
}
