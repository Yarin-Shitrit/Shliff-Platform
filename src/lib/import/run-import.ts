import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import type { TestDb } from '@/test/db';
import { uploads, sheets, blocks, blockMappings, layoutSignatures } from '@/db/schema/source';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { classifyBlock } from '@/lib/classify/rules';
import { mapColumns, findHeaderRow, type ColumnMapping } from '@/lib/classify/map-columns';
import { layoutFingerprint } from '@/lib/classify/signature';
import { CONFIDENCE_THRESHOLD, type BlockArchetype } from '@/lib/classify/types';
import type { BudgetCategory } from '@/db/schema/money';
import { PIPELINE_VERSION } from '@/lib/version';
import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';

type AnyDb = Db | TestDb;

export interface ImportedBlockSummary {
  blockId: string;
  sheetName: string;
  range: CellRange;
  archetype: BlockArchetype;
  confidence: number;
  mappingSource: 'rules' | 'signature';
  needsReview: boolean;
}

export interface ImportReport {
  uploadId: string;
  sheetCount: number;
  blockCount: number;
  /** Blocks whose layout matched a previously confirmed signature. */
  autoRecognized: number;
  needsReview: number;
  blocks: ImportedBlockSummary[];
}

function sliceGrid(grid: SheetGrid, range: CellRange): string[][] {
  const rows: string[][] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col += 1) {
      cells.push(grid.cells[row - 1]?.[col - 1]?.text ?? '');
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Records the upload as failed without ever losing the failure being
 * reported. If this write itself throws — a dropped connection, a write
 * failure — there is nothing useful to do about it, so it is swallowed here;
 * the original error is the one the caller must still see.
 */
async function markFailed(db: AnyDb, uploadId: string, error: unknown): Promise<void> {
  try {
    await db.update(uploads)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(uploads.id, uploadId));
  } catch {
    // Swallowed: see the doc comment above. The original error, rethrown by
    // the caller, is what matters.
  }
}

/**
 * Runs `fn` inside a real database transaction regardless of which concrete
 * driver `db` is.
 *
 * `Db` (postgres-js) and `TestDb` (pglite) each type their own
 * `.transaction()` callback against their own driver-specific `PgTransaction`
 * generic, so a callback typed against the `Db | TestDb` union cannot satisfy
 * both call signatures for TypeScript at once. Both drivers' transaction
 * objects are structurally interchangeable for the insert/select calls this
 * pipeline makes — both extend drizzle's shared `PgDatabase` base — so this
 * routes the call through the `Db` (postgres-js) shape and relabels whatever
 * transaction object comes back as `AnyDb`. That relabeling is compile-time
 * only: at runtime the real object (postgres-js or pglite) and its methods
 * are entirely unaffected by the cast.
 */
async function runInTransaction<T>(
  db: AnyDb,
  fn: (tx: AnyDb) => Promise<T>,
): Promise<T> {
  return (db as Db).transaction((tx) => fn(tx as unknown as AnyDb));
}

/**
 * Runs the full read-side pipeline for one uploaded workbook: extract every
 * sheet, detect its blocks, classify and map each one, reuse any confirmed
 * layout signature, and persist all of it for review.
 *
 * The sheet/block/mapping inserts run inside one transaction, so a failure
 * partway through (e.g. sheet 3 of 5 throwing) leaves no partial rows behind
 * for a retry to duplicate — the transaction rolls back as a unit. The
 * upload's status is written outside the transaction in both directions, so
 * the failure is recorded even though the rows that would have explained it
 * are gone.
 *
 * Nothing here writes canonical financial records — that is the commit step,
 * which happens only after an admin confirms the mappings.
 */
export async function runImport(
  db: AnyDb,
  uploadId: string,
  buffer: Buffer,
): Promise<ImportReport> {
  try {
    const grids = await extractWorkbook(buffer);
    const summaries: ImportedBlockSummary[] = [];
    let autoRecognized = 0;

    await runInTransaction(db, async (tx) => {
      /**
       * Clear anything a previous run left for this upload before inserting.
       *
       * `runImport` is reachable twice for one `uploadId`: the upload route
       * reuses a row that is not yet `parsed` so a failed import can be
       * retried, and two near-simultaneous uploads of byte-identical content
       * both see it as `pending`. Without this delete the second run appends a
       * second set of sheets and blocks instead of replacing the first, and
       * nothing surfaces the duplication. `blocks` cascades from `sheets`.
       */
      await tx.delete(sheets).where(eq(sheets.uploadId, uploadId));

      for (const grid of grids) {
        const [sheetRow] = await tx.insert(sheets).values({
          uploadId,
          name: grid.name,
          index: grid.index,
          rowCount: grid.rowCount,
          colCount: grid.colCount,
        }).returning();

        for (const range of detectBlocks(grid)) {
          const classification = classifyBlock(grid, range);
          const headerRow = findHeaderRow(grid, range);
          const fingerprint = headerRow === null
            ? null
            : layoutFingerprint(grid, range, headerRow);

          let archetype = classification.archetype;
          let confidence = classification.confidence;
          let columnMap: ColumnMapping[] = [];
          let mappingSource: 'rules' | 'signature' = 'rules';
          // Null until a recognized signature says otherwise (Task 15) — the
          // same "no lever yet" state a fresh, never-confirmed block starts
          // in, since auto-recognition only reuses a mapping, it does not
          // confirm the block (see `promoteBlock`'s `confirmedAt` check).
          let budgetCategory: BudgetCategory | null = null;

          const known = fingerprint
            ? await tx.select().from(layoutSignatures)
                .where(eq(layoutSignatures.fingerprint, fingerprint))
            : [];

          if (known.length > 0 && known[0].pipelineVersion === PIPELINE_VERSION) {
            archetype = known[0].archetype;
            columnMap = known[0].columnMap;
            confidence = 1;
            mappingSource = 'signature';
            budgetCategory = known[0].budgetCategory;
            autoRecognized += 1;
          } else {
            columnMap = mapColumns(grid, range, archetype).mappings;
          }

          const [blockRow] = await tx.insert(blocks).values({
            sheetId: sheetRow.id,
            top: range.top,
            left: range.left,
            bottom: range.bottom,
            right: range.right,
            archetype,
            confidence: confidence.toFixed(4),
            headerRow,
            fingerprint,
            pipelineVersion: PIPELINE_VERSION,
            rawGrid: sliceGrid(grid, range),
          }).returning();

          await tx.insert(blockMappings).values({
            blockId: blockRow.id,
            columnMap,
            source: mappingSource,
            budgetCategory,
          });

          summaries.push({
            blockId: blockRow.id,
            sheetName: grid.name,
            range,
            archetype,
            confidence,
            mappingSource,
            needsReview: mappingSource === 'rules'
              && (confidence < CONFIDENCE_THRESHOLD || columnMap.length === 0),
          });
        }
      }
    });

    await db.update(uploads)
      // Clear any error text a previous failed run left, or a successful retry
      // still reads as failed.
      .set({ status: 'parsed', error: null })
      .where(eq(uploads.id, uploadId));

    return {
      uploadId,
      sheetCount: grids.length,
      blockCount: summaries.length,
      autoRecognized,
      needsReview: summaries.filter((s) => s.needsReview).length,
      blocks: summaries,
    };
  } catch (error) {
    await markFailed(db, uploadId, error);
    throw error;
  }
}
