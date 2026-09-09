import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange } from '@/lib/blocks/types';
import { parseNumber } from '@/lib/coerce/number';

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
