import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { parseNumber } from '@/lib/coerce/number';
import { normalizeHebrew } from '@/lib/text/normalize';

/** How many leading rows may be considered as the header. */
const MAX_HEADER_SCAN = 3;

interface RowCounts {
  /** Non-numeric, non-blank cells, counting a run of merged cells once. */
  textCells: number;
  numericCells: number;
}

/**
 * Counts a row's non-blank cells as text or numeric, treating a horizontal run
 * of merged cells that repeat the same value as a single cell.
 *
 * ExcelJS mirrors a merged cell's value onto every column it spans, so a
 * decorative title merged across four columns would otherwise be counted as
 * four header cells — enough to outscore or tie the real header row beneath
 * it (e.g. the sparse "צפי הכנסות - קולאבו" title above the ticket-round
 * header). Counting merge runs once reflects that it is one label, not one
 * per column.
 */
function countRow(grid: SheetGrid, range: CellRange, row: number): RowCounts {
  let textCells = 0;
  let numericCells = 0;
  let prevText: string | null = null;
  let prevMerged = false;

  for (let col = range.left; col <= range.right; col += 1) {
    const cell = grid.cells[row - 1]?.[col - 1];
    if (!cell || cell.text === '') {
      prevText = null;
      prevMerged = false;
      continue;
    }

    // Approximates "same merge range" as "adjacent, both merged, equal text" —
    // there is no merge-range id on Cell to check directly, so two separately
    // merged regions that happen to sit adjacent with identical text would be
    // undercounted by one. Contrived, and absent from every known fixture.
    const isMergeContinuation = cell.isMerged && prevMerged && cell.text === prevText;
    if (!isMergeContinuation) {
      if (parseNumber(cell.value) === null) textCells += 1;
      else numericCells += 1;
    }

    prevText = cell.text;
    prevMerged = cell.isMerged;
  }

  return { textCells, numericCells };
}

/** Whether any cell below `row` within the range holds a number. */
function hasNumericBelow(grid: SheetGrid, range: CellRange, row: number): boolean {
  for (let below = row + 1; below <= range.bottom; below += 1) {
    for (let col = range.left; col <= range.right; col += 1) {
      if (parseNumber(grid.cells[below - 1]?.[col - 1]?.value ?? null) !== null) return true;
    }
  }
  return false;
}

/**
 * A header row is a leading row that is mostly non-numeric text and is followed
 * by at least one row containing a number. Blocks whose data starts immediately
 * (the חוב יוסף label/amount pairs) correctly return null.
 *
 * Several of these sheets carry a sparse title row above the real header (e.g.
 * the budget block's "פירוט הוצאה" / "סה״כ תשלום" row above its four-column
 * header). Among the qualifying rows in the scan window, the row with the most
 * non-numeric text cells is chosen — not simply the first qualifying row —
 * with the earliest row winning ties. A cell holding a Date counts as text
 * here, because parseNumber returns null for dates; the ledger header depends
 * on that to beat the row below it.
 */
export function findHeaderRow(grid: SheetGrid, range: CellRange): number | null {
  const lastScan = Math.min(range.bottom - 1, range.top + MAX_HEADER_SCAN - 1);

  let best: { row: number; textCells: number } | null = null;

  for (let row = range.top; row <= lastScan; row += 1) {
    const { textCells, numericCells } = countRow(grid, range, row);

    if (textCells < 2 || numericCells > textCells) continue;
    if (!hasNumericBelow(grid, range, row)) continue;

    if (!best || textCells > best.textCells) {
      best = { row, textCells };
    }
  }

  return best?.row ?? null;
}

/**
 * Rightmost column of the leading contiguous run of non-blank cells in
 * `headerRow`, starting at `range.left`. Falls back to `range.right` (the
 * full range) when that run is empty, i.e. the very first header cell is
 * itself blank — there is nothing meaningful to trim to.
 *
 * Blankness is judged on the cell text after `normalizeHebrew`, not the raw
 * text: a header cell holding only a directional mark (LRM/RLM, common in
 * this corpus) or bare whitespace normalizes to `''` and must terminate the
 * run exactly as an actually-empty cell does, or a stray mark could silently
 * pull an unrelated block's columns into the run.
 *
 * Mirrors `layoutFingerprint`'s definition of this run in `signature.ts`
 * exactly (down to the same fallback), because a stored mapping must never
 * disagree with the layout signature it was matched against: two blocks
 * sharing a fingerprint must be layouts the same mapping fits. `detectBlocks`
 * can bolt an unrelated table onto the right of a real one when a populated
 * "notes" column prevents an empty-column cut — e.g. the ברן 26 budget block
 * gains a trailing payment-tracker table in one workbook but not another —
 * and this keeps that extra table's columns out of both the fingerprint and
 * the mapping.
 */
export function headerRunEnd(grid: SheetGrid, range: CellRange, headerRow: number): number {
  let col = range.left;
  while (col <= range.right) {
    const text = grid.cells[headerRow - 1]?.[col - 1]?.text ?? '';
    if (normalizeHebrew(text) === '') break;
    col += 1;
  }
  const runEnd = col - 1;
  return runEnd >= range.left ? runEnd : range.right;
}
