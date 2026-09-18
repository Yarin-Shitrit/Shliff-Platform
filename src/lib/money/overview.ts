import { and, eq, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { ledgerEntries } from '@/db/schema/money';
import { toAgorot } from '@/lib/money';
import { seasonMoneySummary } from './summary';
import type { SeasonMoneySummary } from './summary';
import { listMovements } from './ledger';
import type { Movement } from './ledger';
import {
  listBudgetLinesWithActuals, groupBudgetByCategory, budgetTotals,
} from './budget';
import type { BudgetGroup } from './budget';
import { campBudgetFundingAgorot } from './funding';
import { traceBlock } from './trace';
import type { SourceCell, TracedRow } from './trace';

/** How many movements the overview band shows. The rest live on /money/ledger. */
export const RECENT_LIMIT = 5;

export function sourceKey(table: TracedRow['table'], id: string): string {
  return `${table}:${id}`;
}

/**
 * Every source cell the screen needs, in one pass.
 *
 * `traceBlock` (Wave 2) is the only code in the repo that knows how a
 * `source_block_id` + `source_row` pair becomes `תנועות קופה!A41`, and it
 * stays the only such code: this indexes what it returns, one call per
 * *distinct block* rather than one per row. A row with no source block never
 * enters the map, so the caller reads back `undefined` and renders
 * `נרשם ידנית` — the honest answer for a figure a lead typed.
 *
 * The camp's ledger is thirteen rows and its budget twenty-six. A handful of
 * block queries is the right trade here; correctness and legibility beat
 * performance everywhere on this page.
 */
export async function sourceIndexFor(
  db: AnyDb,
  refs: Array<{ table: TracedRow['table']; id: string; sourceBlockId: string | null }>,
): Promise<Map<string, SourceCell>> {
  const blockIds = [...new Set(
    refs.map((ref) => ref.sourceBlockId).filter((id): id is string => id !== null),
  )];
  const wanted = new Set(refs.map((ref) => sourceKey(ref.table, ref.id)));

  const index = new Map<string, SourceCell>();
  for (const blockId of blockIds) {
    // Sequential on purpose: a handful of blocks, each a small independent
    // read, and a serial loop keeps the query log in the order a reader would
    // reconstruct it.
    for (const row of await traceBlock(db, blockId)) {
      const key = sourceKey(row.table, row.id);
      if (!row.source || !wanted.has(key)) continue;
      index.set(key, row.source);
    }
  }
  return index;
}

export interface FundraisingProgress {
  /** The camp budget's share of the year's plan — the same figure the
   *  identity sentence uses, never the whole plan's total. */
  targetAgorot: number;
  /** Season inflow recorded in `ledger_entries`. Dues are excluded by
   *  construction: they live in `payments`, and dues are the camp's own money
   *  while fundraising is money from outside. */
  raisedAgorot: number;
  remainingAgorot: number;
}

export async function fundraisingProgress(
  db: AnyDb, seasonId: string,
): Promise<FundraisingProgress> {
  const targetAgorot = await campBudgetFundingAgorot(db, seasonId);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.seasonId, seasonId),
      eq(ledgerEntries.direction, 'in'),
    ));
  const raisedAgorot = toAgorot(row.total);
  return {
    targetAgorot,
    raisedAgorot,
    // Floored: a target that has been passed is "done", not "minus 500 left".
    remainingAgorot: Math.max(0, targetAgorot - raisedAgorot),
  };
}

/**
 * The newest movements, newest first, plus how many there are in all so the
 * band can offer "לכל N התנועות". `listMovements` returns the season in date
 * order and the camp's whole ledger is tens of rows, so this slices rather
 * than adding a second, differently-ordered query that could disagree with
 * the one /money/ledger will run.
 */
export async function recentMovements(
  db: AnyDb, seasonId: string, limit: number = RECENT_LIMIT,
): Promise<{ rows: Movement[]; total: number }> {
  const all = await listMovements(db, { seasonId });
  return { rows: all.slice(-limit).reverse(), total: all.length };
}

export interface MoneyOverview {
  summary: SeasonMoneySummary;
  budget: BudgetGroup[];
  budgetTotals: ReturnType<typeof budgetTotals>;
  fundraising: FundraisingProgress;
  /** What this screen cannot resolve on its own and לטיפול (D2) can.
   *  Unplaced money is not counted here: it has its own banner with its own
   *  fix in "איפה הכסף", and counting it twice would make the tile disagree
   *  with the band. */
  decisions: { unnamedCount: number; arithmeticCount: number; total: number };
  recent: Movement[];
  movementCount: number;
  sources: Map<string, SourceCell>;
}

/**
 * Everything /money renders, in one call.
 *
 * One shape rather than nine exported queries, for the same reason
 * `seasonMoneySummary` is one shape: the page is a server component, and a
 * summary that forces it into a second round trip to fill a hole is a
 * data-shape defect, not a page defect.
 */
export async function moneyOverview(db: AnyDb, seasonId: string): Promise<MoneyOverview> {
  const summary = await seasonMoneySummary(db, seasonId);
  const lines = await listBudgetLinesWithActuals(db, seasonId);
  const { rows: recent, total: movementCount } = await recentMovements(db, seasonId);

  const arithmeticCount = lines.filter((line) => line.arithmeticOff).length;

  const sources = await sourceIndexFor(db, [
    ...recent.map((move) => ({
      table: 'ledger_entries' as const, id: move.id, sourceBlockId: move.sourceBlockId,
    })),
    ...lines.map((line) => ({
      table: 'budget_lines' as const, id: line.id, sourceBlockId: line.sourceBlockId,
    })),
    ...[...summary.campOwes, ...summary.owedToCamp, ...summary.unnamed].map((row) => ({
      table: 'obligations' as const, id: row.id, sourceBlockId: row.sourceBlockId,
    })),
  ]);

  return {
    summary,
    budget: groupBudgetByCategory(lines),
    budgetTotals: budgetTotals(lines),
    fundraising: await fundraisingProgress(db, seasonId),
    decisions: {
      unnamedCount: summary.unnamed.length,
      arithmeticCount,
      total: summary.unnamed.length + arithmeticCount,
    },
    recent,
    movementCount,
    sources,
  };
}
