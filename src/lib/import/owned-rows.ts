import { count, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
} from '@/db/schema/money';

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
 */
const TABLES = {
  ledger_entries: ledgerEntries,
  budget_lines: budgetLines,
  ticket_rounds: ticketRounds,
  obligations,
} as const;

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
 * rows it really owns rather than zero.
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
