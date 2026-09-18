import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { mapColumns, type ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import type { BudgetCategory } from '@/db/schema/money';
import type { Cell, SheetGrid } from '@/lib/xlsx/types';

type AnyDb = Db | TestDb;

interface StoredBlock {
  top: number;
  left: number;
  bottom: number;
  right: number;
  rawGrid: string[][];
}

/**
 * Rebuilds a `SheetGrid` view of one block from its stored `rawGrid`, so
 * `mapColumns` — written against a full sheet grid plus a `CellRange` — can
 * be reapplied to a block already at rest in the database, without
 * re-reading the original workbook.
 *
 * `rawGrid` (see `sliceGrid` in run-import.ts) keeps only each cell's
 * display text, not its typed value or merge state. `value` is set to that
 * same text: `parseNumber`, all `mapColumns` ever asks of `value` once a
 * header row is known, parses a numeric-looking string exactly as it would
 * the digits `extract.ts`'s `toText` had stringified a numeric cell into in
 * the first place.
 *
 * `isMerged` is always false here, which would normally matter: a
 * horizontally-merged decorative title (mirrored onto every column it spans)
 * can otherwise outscore the real header beneath it once `findHeaderRow`
 * can no longer collapse it back into the one cell it is (header.ts). That
 * gap is harmless here because callers always pass `mapColumns` the block's
 * own stored `headerRow` — computed once at import time against the real,
 * merge-aware grid — so `findHeaderRow` is never re-run against this
 * reconstruction to begin with.
 *
 * `rawGrid`'s rows and columns are block-local (row 0 is `block.top`, as
 * `blockRows` in promote/rows.ts also assumes), while `mapColumns` addresses
 * cells by absolute sheet position, so each cell is placed at
 * `block.top/left + its offset` in a sparse grid — leaving every position
 * outside the block's own rows and columns as a hole, which every reader of
 * `SheetGrid.cells` already treats as blank via `?.`.
 */
function gridFromBlock(block: StoredBlock): SheetGrid {
  const cells: Cell[][] = [];
  block.rawGrid.forEach((row, i) => {
    const globalRow = block.top + i;
    const rowCells: Cell[] = [];
    row.forEach((text, j) => {
      const globalCol = block.left + j;
      rowCells[globalCol - 1] = {
        row: globalRow,
        col: globalCol,
        value: text === '' ? null : text,
        text,
        isMerged: false,
      };
    });
    cells[globalRow - 1] = rowCells;
  });

  return {
    name: '', index: 0, rowCount: block.bottom, colCount: block.right, cells,
  };
}

/**
 * Records an admin's confirmation of one block: updates the block, replaces
 * its mapping, and stores the mapping as a reusable layout signature so the
 * same layout is recognized automatically in future uploads.
 *
 * Takes the database as its first argument, rather than importing `@/db`
 * itself, so it stays importable (and testable against `createTestDb()`)
 * without `DATABASE_URL` set. It is also why this lives outside the
 * `'use server'` actions file: a server action may only take serializable
 * arguments, and a database handle is not one.
 *
 * `budgetCategory` (Task 15) is a lead's explicit statement of which budget a
 * `budget_lines` block belongs to — never inferred from the sheet name or
 * anything else. It is meaningful only for that archetype: stored as given,
 * defaulting to `'camp'` when omitted; every other archetype stores null,
 * even if a caller passes one, because the question does not apply to it.
 */
export async function applyConfirmation(
  db: AnyDb,
  email: string,
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
  budgetCategory?: BudgetCategory,
): Promise<void> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  const storedCategory: BudgetCategory | null = archetype === 'budget_lines'
    ? (budgetCategory ?? 'camp')
    : null;

  // A column map is tied to the archetype it was built for — budget_lines
  // maps a column to `item`/`total`, ledger maps the same position to
  // `date`/`outflow`/`inflow`. Handing the new archetype's promoter a map
  // still speaking the old archetype's fields makes it refuse every row, so
  // a changed archetype always gets its columns recomputed from the block's
  // own stored grid and bounds, discarding whatever map the caller passed
  // for the archetype it is leaving. An unchanged archetype keeps using the
  // passed map verbatim — including an admin's manual edit to it.
  //
  // `block.headerRow` — computed once at import time against the real,
  // merge-aware grid — is passed through rather than letting `mapColumns`
  // re-detect it against `gridFromBlock`'s text-only reconstruction, which
  // has no reliable merge information to find it correctly with. A
  // headerless block (`headerRow` null, which also means it was never
  // fingerprinted) has no such answer to reuse, so `mapColumns` falls back
  // to detection exactly as before.
  const resolvedMap = archetype === block.archetype
    ? columnMap
    : mapColumns(
      gridFromBlock(block), block, archetype, block.headerRow ?? undefined,
    ).mappings;

  await db.update(blocks)
    .set({ archetype, confidence: '1.0000', confirmedBy: email, confirmedAt: new Date() })
    .where(eq(blocks.id, blockId));

  await db.update(blockMappings)
    .set({ columnMap: resolvedMap, source: 'admin', budgetCategory: storedCategory })
    .where(eq(blockMappings.blockId, blockId));

  // Headerless blocks never fingerprinted, so there is nothing for a future
  // upload to recognize this layout by. Never store a signature for them.
  if (!block.fingerprint) return;

  await db.insert(layoutSignatures).values({
    fingerprint: block.fingerprint,
    archetype,
    columnMap: resolvedMap,
    budgetCategory: storedCategory,
    pipelineVersion: block.pipelineVersion,
    confirmedBy: email,
  }).onConflictDoUpdate({
    target: layoutSignatures.fingerprint,
    set: {
      archetype, columnMap: resolvedMap, budgetCategory: storedCategory, confirmedBy: email,
    },
  });
}
