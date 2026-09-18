import { eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { blocks, blockMappings, sheets, uploads } from '@/db/schema/source';
import { colLabel } from '@/lib/xlsx/col-label';
import { normalizeHebrew, isBlank } from '@/lib/text/normalize';
import type { BlockArchetype } from '@/lib/classify/types';

export interface EvidenceCell {
  /** The cell exactly as stored in `raw_grid`. */
  text: string;
  /** `B` — the sheet column letter, from the block's `left` offset. */
  column: string;
  /** True on the one cell this decision is about. */
  marked: boolean;
}

export interface EvidenceRow {
  /** Absolute 1-indexed sheet row. */
  sheetRow: number;
  /** 1-indexed position of the row inside the block's stored grid. */
  blockRow: number;
  cells: EvidenceCell[];
  /** True on the row the decision is about. */
  marked: boolean;
}

export interface Evidence {
  blockId: string;
  sheetName: string;
  filename: string;
  /** `דמי קאמפ!B14`, or `דמי קאמפ!14` when no column was named. */
  reference: string;
  /** Column letters across the block, `left` to `right`. */
  columns: string[];
  rows: EvidenceRow[];
  /** Rows above and below that were not returned. */
  hiddenBefore: number;
  hiddenAfter: number;
}

const DEFAULT_RADIUS = 2;

/**
 * The workbook rows around one cell, read from `blocks.raw_grid` and from
 * nothing else. The page this feeds used to parse three workbooks off disk on
 * every request; E6 and W16 exist because of it.
 *
 * `sheetRow` is absolute, the same number `source_row` stores, so a
 * re-detected block still points at the cell a lead can open. `column` is an
 * absolute sheet column matching `ColumnMapping.column`; the index into a
 * stored row is `column - block.left`.
 */
export async function blockEvidence(
  db: AnyDb,
  blockId: string,
  sheetRow: number,
  opts: { column?: number | null; radius?: number } = {},
): Promise<Evidence | null> {
  const [row] = await db
    .select({
      id: blocks.id, top: blocks.top, left: blocks.left, right: blocks.right,
      rawGrid: blocks.rawGrid, sheetName: sheets.name, filename: uploads.filename,
    })
    .from(blocks)
    .innerJoin(sheets, eq(sheets.id, blocks.sheetId))
    .innerJoin(uploads, eq(uploads.id, sheets.uploadId))
    .where(eq(blocks.id, blockId));
  if (!row) return null;

  const index = sheetRow - row.top;
  if (index < 0 || index >= row.rawGrid.length) return null;

  const radius = opts.radius ?? DEFAULT_RADIUS;
  const from = Math.max(0, index - radius);
  const to = Math.min(row.rawGrid.length - 1, index + radius);

  const width = Math.max(1, row.right - row.left + 1);
  const columns = Array.from({ length: width }, (_, i) => colLabel(row.left + i));

  const markedColumn = opts.column ?? null;
  const markedIndex = markedColumn === null ? null : markedColumn - row.left;

  const rows: EvidenceRow[] = [];
  for (let i = from; i <= to; i += 1) {
    const raw = row.rawGrid[i] ?? [];
    const isMarkedRow = i === index;
    rows.push({
      sheetRow: row.top + i,
      blockRow: i + 1,
      marked: isMarkedRow,
      cells: columns.map((column, c) => ({
        column,
        text: raw[c] ?? '',
        marked: isMarkedRow && markedIndex === c,
      })),
    });
  }

  const reference = markedColumn === null
    ? `${row.sheetName}!${sheetRow}`
    : `${row.sheetName}!${colLabel(markedColumn)}${sheetRow}`;

  return {
    blockId: row.id,
    sheetName: row.sheetName,
    filename: row.filename,
    reference,
    columns,
    rows,
    hiddenBefore: from,
    hiddenAfter: row.rawGrid.length - 1 - to,
  };
}

export interface CopyDiffRow {
  label: string;
  /** One entry per sheet id given, in the order given. `null` means that
   *  copy has no such line at all. */
  values: Array<string | null>;
  differs: boolean;
}

export type CopyDiff =
  | { ok: true; rows: CopyDiffRow[]; differing: number }
  /** Hebrew, shown in place of a comparison that cannot be made honestly. */
  | { ok: false; reason: string };

/** The label and value fields each archetype's column map calls its own. */
const COMPARED_FIELDS: Partial<Record<BlockArchetype, { label: string; value: string }>> = {
  budget_lines: { label: 'item', value: 'total' },
  ledger: { label: 'description', value: 'outflow' },
  ticket_rounds: { label: 'round', value: 'total' },
  obligations: { label: 'description', value: 'amount' },
};

const NO_MAPPING = 'אי אפשר להשוות בין העותקים עד שיאושר שיוך עמודות לשני הצדדים';

/**
 * Line-by-line comparison of the copies of one sheet (W19), so a lead choosing
 * which copy is authoritative sees what the choice costs.
 *
 * The label and value columns come from the stored column map, never from a
 * positional guess: "the first column is the label" is exactly the kind of
 * inference the promoter refuses, and a comparison built on it would show a
 * lead a difference that is not there.
 */
export async function copyDiff(db: AnyDb, sheetIds: string[]): Promise<CopyDiff> {
  if (sheetIds.length < 2) return { ok: false, reason: NO_MAPPING };

  const rows = await db
    .select({
      sheetId: blocks.sheetId, left: blocks.left, top: blocks.top,
      headerRow: blocks.headerRow, archetype: blocks.archetype,
      rawGrid: blocks.rawGrid, columnMap: blockMappings.columnMap,
    })
    .from(blocks)
    .leftJoin(blockMappings, eq(blockMappings.blockId, blocks.id))
    .where(inArray(blocks.sheetId, sheetIds));

  const perSheet = new Map<string, Map<string, string>>();
  const labelOrder: string[] = [];
  const seen = new Set<string>();

  for (const sheetId of sheetIds) perSheet.set(sheetId, new Map());

  for (const block of rows) {
    const fields = COMPARED_FIELDS[block.archetype];
    if (!fields) continue;
    if (!block.columnMap) return { ok: false, reason: NO_MAPPING };

    const labelCol = block.columnMap.find((m) => m.field === fields.label);
    const valueCol = block.columnMap.find((m) => m.field === fields.value);
    if (!labelCol || !valueCol) return { ok: false, reason: NO_MAPPING };

    const into = perSheet.get(block.sheetId);
    if (!into) continue;
    for (let i = 0; i < block.rawGrid.length; i += 1) {
      const sheetRow = block.top + i;
      if (block.headerRow !== null && sheetRow <= block.headerRow) continue;
      const raw = block.rawGrid[i] ?? [];
      const label = raw[labelCol.column - block.left] ?? '';
      if (isBlank(label)) continue;
      const key = normalizeHebrew(label);
      if (!seen.has(key)) { seen.add(key); labelOrder.push(label); }
      into.set(key, raw[valueCol.column - block.left] ?? '');
    }
  }

  for (const sheetId of sheetIds) {
    if ((perSheet.get(sheetId)?.size ?? 0) === 0) return { ok: false, reason: NO_MAPPING };
  }

  const diff: CopyDiffRow[] = labelOrder.map((label) => {
    const key = normalizeHebrew(label);
    const values = sheetIds.map((id) => perSheet.get(id)?.get(key) ?? null);
    const first = values[0];
    return { label, values, differs: values.some((v) => v !== first) };
  });

  return { ok: true, rows: diff, differing: diff.filter((r) => r.differs).length };
}
