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
  if (!PROMOTABLE_ARCHETYPES.includes(input.archetype)) return 'no-promoter';
  if (input.promotedRows > 0) return 'promoted';
  if (input.confirmedAt !== null) return 'confirmed';
  if (needsReview(input.confidence, input.mappingSource, input.columnMap)) {
    return 'needs-review';
  }
  return 'recognised';
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
