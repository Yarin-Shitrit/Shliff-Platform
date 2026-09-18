import { count, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';
import type { PromotedRow } from '@/lib/import/promote/types';

/**
 * The four tables a block's promotion can write rows into (W6). Lives here,
 * outside both `sheets.ts` and `promote/promote.ts`, because R53 needs
 * `sheets.ts` to know "does this block own promoted rows" and `promote.ts`
 * already imports `sheetEligibility` FROM `sheets.ts` — `sheets.ts` importing
 * back from `promote.ts` would be a circular module dependency. This file
 * depends on neither, so both can depend on it.
 *
 * `promote.ts` keeps its OWN copy of this same four-table map for `sweep`'s
 * use, typed against `PromotedRow['table']` there — this is not that
 * duplication risk restated: what must never fork is the QUERY (below), and
 * it lives in exactly one place.
 *
 * `satisfies Record<PromotedRow['table'], unknown>` is the seam that keeps
 * the two maps from silently diverging even though nothing else connects
 * them: `types.ts` imports from neither `promote.ts` nor `sheets.ts`, so
 * importing its `PromotedRow` type here creates no cycle. `promote.ts`'s own
 * `TABLES` is already pinned to `PromotedRow['table']` indirectly, through
 * `TABLES[table]` where `table: TargetTable = PromotedRow['table']` — a
 * missing key there fails to compile at the point it is indexed. This map
 * has no such indexing use, only `Object.values(TABLES)`, which would not
 * itself catch a missing key — so the `satisfies` clause is what makes a
 * miss here fail to compile too. A miss would matter badly: it would make
 * `promotedRowCounts` silently report a genuinely-promoted block as
 * never-promoted, which is exactly the fact `promoteAllGated`'s
 * already-promoted gate and the register's `confirmed-not-promoted` state
 * both rest on.
 */
const TABLES = {
  ledger_entries: ledgerEntries,
  budget_lines: budgetLines,
  ticket_rounds: ticketRounds,
  obligations,
} as const satisfies Record<PromotedRow['table'], unknown>;

/**
 * Which of `blockIds` already own at least one row in any of the four target
 * tables, by non-null `source_block_id` — and how many.
 *
 * Used by `promote.ts` (the already-promoted gate in `promoteAllGated`, and
 * the retired-sheet skip's reported `rowCount`) and by `sheets.ts` (R53: a
 * sheet cannot be made authoritative while a retired rival still owns
 * promoted rows nothing will ever release). Kept in exactly one place so
 * "does this block already have rows" cannot answer differently depending
 * on which caller asks.
 *
 * Four queries for the whole set, not one per block: each is a single
 * grouped `count(*) … where source_block_id in (…)`, over `TABLES`. A block
 * appears in the result only if it has rows, so a count-reading caller uses
 * `?? 0` and a yes/no-reading caller uses `.has(blockId)`.
 *
 * Every archetype writes to exactly one of these four tables (W6), but all
 * four are counted for every block regardless of its *current* archetype: a
 * block whose archetype was re-decided after a promotion still reports the
 * rows it really owns rather than zero. That is not incidental here — it is
 * the property the already-promoted gate depends on. A block promoted as
 * `ledger` and later re-confirmed as `budget_lines` still owns real
 * `ledger_entries` rows until something sweeps them; a query that only
 * checked the table its *current* archetype writes to would report it as
 * never-promoted and let `promoteAllGated` promote it again, silently
 * re-opening the hazard that gate exists to close.
 */
export async function promotedRowCounts(
  db: AnyDb, blockIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (blockIds.length === 0) return totals;

  const groups = await Promise.all(
    Object.values(TABLES).map((t) => db
      .select({ blockId: t.sourceBlockId, n: count() })
      .from(t)
      .where(inArray(t.sourceBlockId, blockIds))
      .groupBy(t.sourceBlockId)),
  );

  for (const rows of groups) {
    for (const row of rows) {
      if (row.blockId === null) continue;
      totals.set(row.blockId, (totals.get(row.blockId) ?? 0) + Number(row.n));
    }
  }
  return totals;
}
