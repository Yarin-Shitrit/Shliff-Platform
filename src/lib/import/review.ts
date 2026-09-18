import type { ColumnMapping } from '@/lib/classify/map-columns';
import { confidenceWord, CONFIDENCE_RANK } from '@/lib/classify/field-labels';
import { isBlank } from '@/lib/text/normalize';
import { colLabel } from '@/lib/xlsx/col-label';

const SAMPLE_COUNT = 3;

export interface ColumnRow {
  /** 1-indexed sheet column. */
  column: number;
  /** `A`, `H`, `AA` — what Excel calls it. */
  label: string;
  /** The header cell's text, or '' when the block has no header row. */
  header: string;
  /** Up to three non-blank values from below the header. */
  samples: string[];
  /** Canonical field, or null when nothing maps this column. */
  field: string | null;
  confidence: number | null;
}

/** Block geometry as `blockStates` reports it. */
export interface BlockShape {
  top: number; left: number; right: number;
  headerRow: number | null;
  rawGrid: string[][];
}

/**
 * An unmapped column sorts above a weakly-mapped one because it is the place
 * the system has the least to say, and D10 asks for the unsure first. The
 * reordering is safe only because every row carries its A1 letter: without
 * it a lead would lose track of which column of the workbook they are
 * looking at.
 */
function byUnsureFirst(a: ColumnRow, b: ColumnRow): number {
  return CONFIDENCE_RANK[confidenceWord(a.confidence)]
    - CONFIDENCE_RANK[confidenceWord(b.confidence)]
    || a.column - b.column;
}

/**
 * One row per column of the block that carries anything at all — not one row
 * per mapping. A column nothing maps is the most important row on this
 * screen, and a mapping-shaped list would leave it out entirely.
 *
 * Blankness uses `isBlank`, never `.trim()`: a cell of invisible directional
 * marks is empty, and the workbooks are full of them.
 */
export function columnRows(
  block: BlockShape, columnMap: ColumnMapping[],
): ColumnRow[] {
  const byColumn = new Map(columnMap.map((m) => [m.column, m]));
  const headerIndex = block.headerRow === null ? -1 : block.headerRow - block.top;
  const rows: ColumnRow[] = [];

  for (let column = block.left; column <= block.right; column += 1) {
    const c = column - block.left;

    const samples: string[] = [];
    for (
      let r = headerIndex + 1;
      r < block.rawGrid.length && samples.length < SAMPLE_COUNT;
      r += 1
    ) {
      const text = block.rawGrid[r]?.[c] ?? '';
      if (!isBlank(text)) samples.push(text);
    }

    const header = headerIndex < 0 ? '' : (block.rawGrid[headerIndex]?.[c] ?? '');
    // A column with no header and no value is a gutter detectBlocks swept in,
    // not a column a lead has a decision to make about.
    if (isBlank(header) && samples.length === 0) continue;

    const mapping = byColumn.get(column);
    rows.push({
      column,
      label: colLabel(column),
      header,
      samples,
      field: mapping?.field ?? null,
      confidence: mapping?.confidence ?? null,
    });
  }

  return rows.sort(byUnsureFirst);
}
