import type { ColumnMapping } from '@/lib/classify/map-columns';
import type { BlockArchetype } from '@/lib/classify/types';
import { confidenceWord, CONFIDENCE_RANK } from '@/lib/classify/field-labels';
import type {
  PromotionResult, Refusal, RefusalReason,
} from '@/lib/import/promote/types';
import { isBlank } from '@/lib/text/normalize';
import { colLabel } from '@/lib/xlsx/col-label';
import type { BlockState } from './register';

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

export type GridRowState = 'header' | 'written' | 'noted' | 'refused' | 'untouched';

export interface GridRow {
  /** Absolute 1-indexed sheet row — W3's number, the one a trace renders. */
  sheetRow: number;
  cells: string[];
  state: GridRowState;
  /** The promoter's Hebrew, verbatim: a refusal's message, or the notes. */
  message: string | null;
}

/**
 * The reasons the promoter attaches to the block's own top row rather than to
 * a row of data. `promoteBlock` files them at `block.top`, which is usually
 * the header row — so rendering them in the grid would either tint the header
 * or vanish behind it. They belong above the table, as a banner.
 */
export const WHOLE_BLOCK_REASONS: readonly RefusalReason[] = [
  'unconfirmed', 'no-promoter', 'unmapped-column',
  'sheet-undecided', 'sheet-ambiguous', 'sheet-superseded',
];

export function blockRefusal(
  result: Pick<PromotionResult, 'refused'>,
): Refusal | null {
  return result.refused.find((r) => WHOLE_BLOCK_REASONS.includes(r.reason)) ?? null;
}

/**
 * The block's cells with the dry run's verdict on each row, so the refusals
 * sit where the rows are rather than in a list somewhere else. Every message
 * is the promoter's own Hebrew, passed through untouched: this screen shows
 * refusals, it does not word them.
 */
export function gridRows(
  block: Pick<BlockShape, 'top' | 'headerRow' | 'rawGrid'>,
  result: Pick<PromotionResult, 'written' | 'refused'>,
): GridRow[] {
  const written = new Map(result.written.map((r) => [r.sheetRow, r]));
  const refused = new Map(
    result.refused
      .filter((r) => !WHOLE_BLOCK_REASONS.includes(r.reason))
      .map((r) => [r.sheetRow, r]),
  );

  return block.rawGrid.map((cells, index) => {
    const sheetRow = block.top + index;
    if (block.headerRow !== null && sheetRow <= block.headerRow) {
      return { sheetRow, cells, state: 'header' as const, message: null };
    }
    const refusal = refused.get(sheetRow);
    if (refusal) {
      return { sheetRow, cells, state: 'refused' as const, message: refusal.message };
    }
    const row = written.get(sheetRow);
    if (row) {
      return row.notes.length > 0
        ? { sheetRow, cells, state: 'noted' as const, message: row.notes.join(' · ') }
        : { sheetRow, cells, state: 'written' as const, message: null };
    }
    return { sheetRow, cells, state: 'untouched' as const, message: null };
  });
}

export interface PromotionSummary {
  blocks: number; written: number; noted: number;
  refused: number; deleted: number; retained: number;
}

/**
 * The four counts Wave 2's bulk promotion reports — written, refused, deleted
 * and retained — plus the noted count the pre-flight line needs, so this
 * screen's footer and לטיפול's bulk bar say the same thing in the same shape.
 */
export function summarise(results: PromotionResult[]): PromotionSummary {
  return {
    blocks: results.length,
    written: results.reduce((n, r) => n + r.written.length, 0),
    noted: results.reduce(
      (n, r) => n + r.written.filter((w) => w.notes.length > 0).length, 0,
    ),
    refused: results.reduce((n, r) => n + r.refused.length, 0),
    deleted: results.reduce((n, r) => n + r.deleted, 0),
    retained: results.reduce((n, r) => n + r.retained.length, 0),
  };
}

/**
 * The next block still wanting a human, wrapping past the end. The current
 * block is always excluded, so confirming the last open one answers null and
 * the footer can say the file is done rather than re-opening what was just
 * finished.
 */
export function nextUnreviewed(
  blocks: Array<{ blockId: string; state: BlockState }>, currentId: string,
): string | null {
  const open = (s: BlockState) => s === 'needs-review' || s === 'recognised';
  const at = blocks.findIndex((b) => b.blockId === currentId);
  const order = at < 0 ? blocks : [...blocks.slice(at + 1), ...blocks.slice(0, at)];
  return order.find((b) => open(b.state))?.blockId ?? null;
}

/**
 * A stable identity for the mapping the server currently holds.
 *
 * The column editor keeps a draft in client state. When the archetype
 * changes, `applyConfirmation` discards the map it was handed and recomputes
 * it from the block's own grid (hardening T2) — so the draft the browser is
 * holding is now describing a mapping that no longer exists. Passing this as
 * the editor's `key` remounts it whenever the server's answer changed, which
 * is what makes "re-read rather than re-send" structural rather than a rule
 * someone has to remember. A local edit does not change props, so it does not
 * remount.
 */
export function mappingKey(
  archetype: BlockArchetype, columnMap: ColumnMapping[],
): string {
  const fields = [...columnMap]
    .sort((a, b) => a.column - b.column)
    .map((m) => `${m.column}=${m.field}`)
    .join(',');
  return `${archetype}|${fields}`;
}

export type ReviewStep = 1 | 2 | 3 | 4;

/** העלאה · זיהוי טבלאות · סקירה ואישור · קידום לנתונים. */
export function reviewStep(
  upload: { status: string }, blocks: Array<{ state: BlockState }>,
): ReviewStep {
  if (upload.status === 'pending' || upload.status === 'failed') return 1;
  if (blocks.length === 0) return 2;
  const settled = (s: BlockState) =>
    s === 'promoted' || s === 'no-promoter' || s === 'superseded';
  return blocks.every((b) => settled(b.state)) ? 4 : 3;
}
