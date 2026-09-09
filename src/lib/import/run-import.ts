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
 * Runs the full read-side pipeline for one uploaded workbook: extract every
 * sheet, detect its blocks, classify and map each one, reuse any confirmed
 * layout signature, and persist all of it for review.
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

    for (const grid of grids) {
      const [sheetRow] = await db.insert(sheets).values({
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

        const known = fingerprint
          ? await db.select().from(layoutSignatures)
              .where(eq(layoutSignatures.fingerprint, fingerprint))
          : [];

        if (known.length > 0 && known[0].pipelineVersion === PIPELINE_VERSION) {
          archetype = known[0].archetype;
          columnMap = known[0].columnMap;
          confidence = 1;
          mappingSource = 'signature';
          autoRecognized += 1;
        } else {
          columnMap = mapColumns(grid, range, archetype).mappings;
        }

        const [blockRow] = await db.insert(blocks).values({
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

        await db.insert(blockMappings).values({
          blockId: blockRow.id,
          columnMap,
          source: mappingSource,
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

    await db.update(uploads)
      .set({ status: 'parsed' })
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
    await db.update(uploads)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(uploads.id, uploadId));
    throw error;
  }
}
