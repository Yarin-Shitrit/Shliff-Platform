import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { mapColumns, type ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
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
 * same text: `parseNumber`, all `findHeaderRow`/`mapColumns` ever ask of
 * `value`, parses a numeric-looking string exactly as it would the digits
 * `extract.ts`'s `toText` had stringified a numeric cell into in the first
 * place. Losing `isMerged` only matters for choosing *which* row is the
 * header among rows this same block already had a header among when it was
 * first imported — re-mapping never changes the layout, so it never changes
 * that answer.
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
 */
export async function applyConfirmation(
  db: AnyDb,
  email: string,
  blockId: string,
  archetype: BlockArchetype,
  columnMap: ColumnMapping[],
): Promise<void> {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) throw new Error(`unknown block ${blockId}`);

  // A column map is tied to the archetype it was built for — budget_lines
  // maps a column to `item`/`total`, ledger maps the same position to
  // `date`/`outflow`/`inflow`. Handing the new archetype's promoter a map
  // still speaking the old archetype's fields makes it refuse every row, so
  // a changed archetype always gets its columns recomputed from the block's
  // own stored grid and bounds, discarding whatever map the caller passed
  // for the archetype it is leaving. An unchanged archetype keeps using the
  // passed map verbatim — including an admin's manual edit to it.
  const resolvedMap = archetype === block.archetype
    ? columnMap
    : mapColumns(gridFromBlock(block), block, archetype).mappings;

  await db.update(blocks)
    .set({ archetype, confidence: '1.0000', confirmedBy: email, confirmedAt: new Date() })
    .where(eq(blocks.id, blockId));

  await db.update(blockMappings)
    .set({ columnMap: resolvedMap, source: 'admin' })
    .where(eq(blockMappings.blockId, blockId));

  // Headerless blocks never fingerprinted, so there is nothing for a future
  // upload to recognize this layout by. Never store a signature for them.
  if (!block.fingerprint) return;

  await db.insert(layoutSignatures).values({
    fingerprint: block.fingerprint,
    archetype,
    columnMap: resolvedMap,
    pipelineVersion: block.pipelineVersion,
    confirmedBy: email,
  }).onConflictDoUpdate({
    target: layoutSignatures.fingerprint,
    set: { archetype, columnMap: resolvedMap, confirmedBy: email },
  });
}
