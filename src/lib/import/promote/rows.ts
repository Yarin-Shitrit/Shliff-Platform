import type { ColumnMapping } from '@/lib/classify/map-columns';
import { normalizeHebrew, isBlank } from '@/lib/text/normalize';
import type { Refusal, RefusalReason } from './types';

export interface BlockShape {
  top: number;
  left: number;
  headerRow: number | null;
  rawGrid: string[][];
}

export interface BlockRow {
  /** Absolute 1-indexed sheet row. */
  sheetRow: number;
  /** Canonical field name -> cell text, per the block's column map. */
  cells: Record<string, string>;
  /** The row exactly as stored, for the register's evidence column. */
  raw: string[];
}

/**
 * Walks a block's stored grid into mapped rows.
 *
 * `ColumnMapping.column` is a 1-indexed *sheet* column, so the index into a
 * `rawGrid` row is `column - block.left`. `sheetRow` is absolute for the same
 * reason `source_row` is: a trace has to name a real cell, and it has to keep
 * naming the right one if the block's bounds are re-detected.
 */
export function blockRows(block: BlockShape, columnMap: ColumnMapping[]): BlockRow[] {
  const out: BlockRow[] = [];
  for (let i = 0; i < block.rawGrid.length; i += 1) {
    const sheetRow = block.top + i;
    if (block.headerRow !== null && sheetRow <= block.headerRow) continue;

    const raw = block.rawGrid[i] ?? [];
    const cells: Record<string, string> = {};
    for (const mapping of columnMap) {
      cells[mapping.field] = raw[mapping.column - block.left] ?? '';
    }
    out.push({ sheetRow, cells, raw });
  }
  return out;
}

/** A `סה״כ` row is a computed total, not a movement (W8). */
export function isTotalRow(raw: string[]): boolean {
  return raw.some((cell) => normalizeHebrew(cell).includes('סה"כ'));
}

/**
 * `מעבר לקובץ חדש 44,647` closes the previous book and opens this one.
 * Importing it as income counts the previous book's money a second time.
 */
export function isCarryForward(raw: string[]): boolean {
  return raw.some((cell) => normalizeHebrew(cell).includes('מעבר לקובץ חדש'));
}

export function isBlankRow(raw: string[]): boolean {
  return raw.every((cell) => isBlank(cell));
}

export function refuse(
  row: { sheetRow: number; raw: string[] }, reason: RefusalReason, message: string,
): Refusal {
  return { sheetRow: row.sheetRow, reason, message, cells: row.raw };
}
