import { asc, eq, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { personAliases } from '@/db/schema/camp';
import { obligations } from '@/db/schema/money';
import { normalizeHebrew } from '@/lib/text/normalize';
import { traceRow, type SourceCell } from '@/lib/money/trace';

/**
 * R11 for names, not just numbers — but derived, never stored.
 *
 * `person_aliases` carries `source` (`manual` | `import`) and no
 * `source_block_id` — only the five money tables have those columns, and this
 * module adds none. So provenance for a name is worked out at read time:
 *
 * - `source === 'manual'` renders C12's manual form, `נרשם ידנית`. That is
 *   the whole truth about it — no cell, ever.
 * - `source === 'import'` gets a cell when one can be shown honestly. The
 *   promoter records an unlinked name from exactly one place — `promote.ts`'s
 *   obligations branch, from `outcome.partyRaw` — and the same row is written
 *   to `obligations` with its `party_name`, `source_block_id` and
 *   `source_row`. So an import alias's cell is the cell of the obligation
 *   whose `normalizeHebrew(party_name)` equals the alias's `normalized`,
 *   read through the existing `traceRow`.
 * - An import alias with no such row, or whose matching obligation has a
 *   null `source_block_id` (a debt entered by hand), renders **no cell** —
 *   never an invented one.
 *
 * Matching is on the normalized form — the same comparison `resolveName`
 * already makes — so an alias and its obligation cannot disagree about
 * whether they are the same string.
 */
export interface AliasSource {
  aliasId: string;
  alias: string;
  source: string;
  /** Set when this spelling arrived in a merge, naming the person it came from. */
  mergedFromPersonId: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  /** The workbook cell, when one can be shown honestly. Null for a manual
   *  alias and for an import alias nothing in the workbooks corroborates. */
  cell: SourceCell | null;
}

export async function aliasSourcesFor(db: AnyDb, personId: string): Promise<AliasSource[]> {
  const aliasRows = await db
    .select({
      aliasId: personAliases.id,
      alias: personAliases.alias,
      normalized: personAliases.normalized,
      source: personAliases.source,
      mergedFromPersonId: personAliases.mergedFromPersonId,
      confirmedBy: personAliases.confirmedBy,
      confirmedAt: personAliases.confirmedAt,
    })
    .from(personAliases)
    .where(eq(personAliases.personId, personId))
    .orderBy(asc(personAliases.alias));

  // One statement for every named obligation, regardless of which alias it
  // might corroborate — bounded by how many debts the workbooks name, read
  // once per call rather than once per alias.
  const namedObligations = await db
    .select({ id: obligations.id, partyName: obligations.partyName })
    .from(obligations)
    .where(isNotNull(obligations.partyName));

  const obligationIdByNormalized = new Map<string, string>();
  for (const row of namedObligations) {
    const normalized = normalizeHebrew(row.partyName as string);
    if (!obligationIdByNormalized.has(normalized)) {
      obligationIdByNormalized.set(normalized, row.id);
    }
  }

  const result: AliasSource[] = [];
  for (const row of aliasRows) {
    let cell: SourceCell | null = null;
    if (row.source === 'import') {
      const obligationId = obligationIdByNormalized.get(row.normalized);
      // traceRow itself returns null for a null source_block_id — the
      // "entered by hand" obligation case — so no extra check is needed here.
      if (obligationId) cell = await traceRow(db, 'obligations', obligationId);
    }
    result.push({
      aliasId: row.aliasId,
      alias: row.alias,
      source: row.source,
      mergedFromPersonId: row.mergedFromPersonId,
      confirmedBy: row.confirmedBy,
      confirmedAt: row.confirmedAt,
      cell,
    });
  }
  return result;
}
