import { eq, isNotNull, sql } from 'drizzle-orm';
import { CONFIDENCE_THRESHOLD, type BlockArchetype } from '@/lib/classify/types';
import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { AnyDb } from '@/lib/db-types';
import { sheets, blocks, blockMappings } from '@/db/schema/source';
import { seasons } from '@/db/schema/camp';
import {
  ledgerEntries, budgetLines, ticketRounds, obligations,
  type BudgetCategory,
} from '@/db/schema/money';
import { sheetEligibility, type SheetState } from '@/lib/import/sheets';
import { promoteBlock } from '@/lib/import/promote/promote';
import type { PromotionResult } from '@/lib/import/promote/types';
import { colLabel } from '@/lib/xlsx/col-label';

/** The four archetypes Wave 2's promoter dispatches on (W6). The rest are
 *  refused with a stated reason and appear as parked, never silently absent. */
export const PROMOTABLE_ARCHETYPES: readonly BlockArchetype[] = [
  'ledger', 'budget_lines', 'ticket_rounds', 'obligations',
];

/**
 * Exactly one state per block, in W17's vocabulary. Both this screen's rail
 * and לטיפול's queue render from here, so the count of open decisions is one
 * number computed once rather than two numbers that drift.
 *
 * This vocabulary is deliberately finer than `src/lib/data/worklist.ts`'s
 * six states: `needs-review` and `recognised` are both `unconfirmed` there,
 * and `blocked` is part of its `refused`. The one fact the two must agree on
 * is what `promoted` means, and they do — rows counted in the four target
 * tables, never rows a dry run predicts.
 */
export type BlockState =
  | 'needs-review' | 'recognised' | 'confirmed' | 'promoted'
  | 'no-promoter' | 'superseded' | 'blocked';

/**
 * A block still needs a human only if nothing has reviewed it yet. Once a
 * signature auto-recognized it, or an admin confirmed it, it is resolved —
 * even if the column map it was confirmed with is empty.
 *
 * Lifted unchanged from the review page, where it was a private function, so
 * that the file list, the rail and לטיפול all answer this the same way.
 */
export function needsReview(
  confidence: number, mappingSource: string, columnMap: ColumnMapping[],
): boolean {
  return mappingSource === 'rules'
    && (confidence < CONFIDENCE_THRESHOLD || columnMap.length === 0);
}

/**
 * Precedence is first-match-wins, and the order is chosen so the most
 * actionable truth is the one on the pill. A superseded copy and a block with
 * no promoter can never promote, so saying so outranks saying it was
 * confirmed; an undecided sheet outranks both because it is the only one of
 * the three a lead can fix.
 *
 * `no-promoter` is the one that does NOT outrank an open review, and the
 * exception is load-bearing. A block's archetype is exactly what the review
 * changes: `unknown` is the classifier's way of saying it could not tell, and
 * reporting that as "this archetype has no promoter" turns the single most
 * reviewable block on the screen into a dead end. Downstream, `reviewStep`
 * treats `no-promoter` as settled, so a file whose tables all classified
 * `unknown` would report zero open decisions, offer nothing for המשך סקירה to
 * open, and read as finished — a silent answer where the platform requires a
 * visible decision. Once a lead HAS confirmed the block, `no-promoter` is the
 * honest label and outranks everything but the sheet's own state.
 */
export function blockState(input: {
  archetype: BlockArchetype;
  confidence: number;
  mappingSource: string;
  columnMap: ColumnMapping[];
  confirmedAt: Date | null;
  promotedRows: number;
  sheetState: SheetState;
}): BlockState {
  if (input.sheetState === 'superseded') return 'superseded';
  if (input.sheetState !== 'eligible') return 'blocked';
  if (input.confirmedAt === null && input.promotedRows === 0) {
    return needsReview(input.confidence, input.mappingSource, input.columnMap)
      ? 'needs-review'
      : 'recognised';
  }
  if (!PROMOTABLE_ARCHETYPES.includes(input.archetype)) return 'no-promoter';
  if (input.promotedRows > 0) return 'promoted';
  return 'confirmed';
}

const PROVENANCE_TABLES = [ledgerEntries, budgetLines, ticketRounds, obligations];

/**
 * How many rows each block has actually written, across the four tables the
 * promoter targets. This is the honest answer to "what did promoting this
 * file produce": it counts rows that exist rather than re-running a promoter
 * and reporting what it would do.
 *
 * `uploads.status` carries a `committed` value that nothing in the running
 * app ever writes — only three test fixtures do — so no screen may read the
 * promotion state off that column.
 */
export async function promotedRowCounts(db: AnyDb): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of PROVENANCE_TABLES) {
    const rows = await db
      .select({ blockId: table.sourceBlockId, n: sql<number>`count(*)::int` })
      .from(table)
      .where(isNotNull(table.sourceBlockId))
      .groupBy(table.sourceBlockId);
    for (const row of rows) {
      if (row.blockId === null) continue;
      counts.set(row.blockId, (counts.get(row.blockId) ?? 0) + row.n);
    }
  }
  return counts;
}

export interface SheetLabel {
  sheetId: string;
  name: string;
  index: number;
  rowCount: number;
  colCount: number;
  seasonId: string | null;
  seasonName: string | null;
  authoritative: boolean | null;
  state: SheetState;
  /** Ids of the sheets this one collides with, across every upload. */
  contestedWith: string[];
}

/**
 * `uploadId` is optional because לטיפול wants every sheet and this screen
 * wants one file's. Eligibility is always computed across every upload —
 * a collision is a fact about two files, so narrowing the input would hide
 * exactly the case the decision exists for.
 */
export async function sheetLabels(db: AnyDb, uploadId?: string): Promise<SheetLabel[]> {
  const eligibility = await sheetEligibility(db);

  const rows = await db.select({
    sheetId: sheets.id,
    name: sheets.name,
    index: sheets.index,
    rowCount: sheets.rowCount,
    colCount: sheets.colCount,
    seasonId: sheets.seasonId,
    seasonName: seasons.name,
    authoritative: sheets.authoritative,
  })
    .from(sheets)
    .leftJoin(seasons, eq(seasons.id, sheets.seasonId))
    .where(uploadId ? eq(sheets.uploadId, uploadId) : undefined);

  return rows
    .map((row) => ({
      ...row,
      state: eligibility.get(row.sheetId)?.state ?? 'eligible',
      contestedWith: eligibility.get(row.sheetId)?.contestedWith ?? [],
    }))
    .sort((a, b) => a.index - b.index);
}

export interface BlockStateRow {
  blockId: string;
  sheetId: string;
  sheetName: string;
  uploadId: string;
  archetype: BlockArchetype;
  confidence: number;
  top: number; left: number; bottom: number; right: number;
  /** `A3:H61`. */
  range: string;
  rowCount: number;
  headerRow: number | null;
  columnMap: ColumnMapping[];
  mappingSource: string;
  /** The mapping's stored budget-category decision, or null when the block
   *  is not a budget block or predates the column. Read from the MAPPING,
   *  never from a promoted row: the row is derived from the mapping, and a
   *  screen that read the row would be right under one resolution of the
   *  re-promotion conflict and silently wrong under the other. */
  budgetCategory: BudgetCategory | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  promotedRows: number;
  state: BlockState;
}

export async function blockStates(
  db: AnyDb, uploadId?: string,
): Promise<BlockStateRow[]> {
  const [eligibility, counts] = await Promise.all([
    sheetEligibility(db),
    promotedRowCounts(db),
  ]);

  const rows = await db
    .select({ block: blocks, sheet: sheets, mapping: blockMappings })
    .from(blocks)
    .innerJoin(sheets, eq(blocks.sheetId, sheets.id))
    .leftJoin(blockMappings, eq(blockMappings.blockId, blocks.id))
    .where(uploadId ? eq(sheets.uploadId, uploadId) : undefined);

  return rows
    .map(({ block, sheet, mapping }) => {
      const columnMap = mapping?.columnMap ?? [];
      const mappingSource = mapping?.source ?? 'rules';
      const confidence = Number(block.confidence);
      const promotedRows = counts.get(block.id) ?? 0;
      const sheetState = eligibility.get(sheet.id)?.state ?? 'eligible';
      return {
        blockId: block.id,
        sheetId: sheet.id,
        sheetName: sheet.name,
        uploadId: sheet.uploadId,
        archetype: block.archetype,
        confidence,
        top: block.top, left: block.left, bottom: block.bottom, right: block.right,
        range: `${colLabel(block.left)}${block.top}:${colLabel(block.right)}${block.bottom}`,
        rowCount: block.bottom - block.top + 1,
        headerRow: block.headerRow,
        columnMap,
        mappingSource,
        budgetCategory: mapping?.budgetCategory ?? null,
        confirmedBy: block.confirmedBy,
        confirmedAt: block.confirmedAt,
        promotedRows,
        state: blockState({
          archetype: block.archetype,
          confidence,
          mappingSource,
          columnMap,
          confirmedAt: block.confirmedAt,
          promotedRows,
          sheetState,
        }),
      };
    })
    .sort((a, b) => a.sheetName.localeCompare(b.sheetName, 'he') || a.top - b.top);
}

/**
 * Promotes one upload's eligible blocks, in turn.
 *
 * **This screen promotes one file, never the database.** Wave 2's
 * `promoteAll` (W15) is the right call for לטיפול, where bulk promotion
 * belongs per D2 — but on a file's own review it would silently write another
 * file's blocks, and a lead pressing "קידום 3 טבלאות מאושרות" beside a
 * filename has consented to three tables in that file. Integration A23 is the
 * sharper version of the same point: re-promoting one known block doubles
 * ברן 26's budget, unrepairably, so nothing outside לטיפול may reach for a
 * whole-database promotion. `promoteUpload` is composition only — it calls
 * `promoteBlock` and touches nothing under `src/lib/import/promote/`.
 *
 * Sequential rather than `Promise.all`: each `promoteBlock` opens its own
 * transaction, and a burst of concurrent transactions on one connection is
 * not a shape this pipeline has ever been built for. A file holds a dozen
 * blocks; the ordering costs nothing and the failure mode it avoids is the
 * expensive kind.
 *
 * The blocks it acts on are those in state `confirmed`, and nothing else
 * (integration A34). An already-`promoted` block is deliberately not among
 * them, and the reason is the mechanism rather than tidiness: `promoteBlock`
 * sweeps a block's prior rows before writing, which makes a re-run a
 * replacement — except for a row something else references. That one is
 * `retained`, not deleted, so when the re-run produces rows the old ones did
 * not cover, the retained rows stay and the new ones land beside them. The
 * count grows, and the growth is the camp's money counted twice. Measured on
 * a real database in `register.test.ts`: two dancefloor lines carrying task
 * references, one corrected column map, and ₪64,375.30 becomes ₪119,375.30.
 *
 * Re-promotion is still how a lead fixes a column map (W4, W5) — as a
 * SINGLE-block action on the review screen, which renders that block's
 * `deleted` and `retained` before anything is written. That is the difference
 * A34 rests on: there a lead consents to a known outcome, whereas one
 * file-wide button hides the same outcome behind a single number.
 *
 * The rest are skipped: `promoteBlock` would refuse each of them anyway, and
 * calling it only to collect a refusal turns a clean "3 tables" into a report
 * about eight.
 */
export async function promoteUpload(
  db: AnyDb, uploadId: string, opts: { dryRun: boolean; recordedBy: string },
): Promise<PromotionResult[]> {
  const states = await blockStates(db, uploadId);
  const eligible = states.filter((b) => b.state === 'confirmed');

  const results: PromotionResult[] = [];
  for (const block of eligible) {
    results.push(await promoteBlock(db, block.blockId, opts));
  }
  return results;
}

/**
 * One block's cells, for the one block a lead has open.
 *
 * Deliberately not part of `BlockStateRow`: the file list calls `blockStates`
 * for every upload, and carrying every block's whole grid through it to render
 * one would be the same waste as the eleven dry runs the review page already
 * refuses to make. Answers null for a block that is not there, because that is
 * a 404 the page renders rather than a failure.
 */
export async function blockGrid(
  db: AnyDb, blockId: string,
): Promise<string[][] | null> {
  const [row] = await db.select({ rawGrid: blocks.rawGrid })
    .from(blocks).where(eq(blocks.id, blockId));
  return row?.rawGrid ?? null;
}
