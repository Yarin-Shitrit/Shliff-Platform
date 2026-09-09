import type { SheetGrid } from '@/lib/xlsx/types';
import type { CellRange, DetectOptions } from './types';

type Axis = 'vertical' | 'horizontal';

const other = (axis: Axis): Axis => (axis === 'vertical' ? 'horizontal' : 'vertical');

/**
 * Recursive XY-cut. Finds rectangular islands of data in a sheet that may hold
 * several unrelated tables side by side.
 *
 * A sheet is cut on runs of fully-empty columns, then fully-empty rows,
 * alternating until no cut is possible. Each remaining region is a block.
 */
export function detectBlocks(grid: SheetGrid, options: DetectOptions = {}): CellRange[] {
  const minGapCols = options.minGapCols ?? 1;
  const minGapRows = options.minGapRows ?? 2;
  const blocks: CellRange[] = [];

  const filled = (row: number, col: number): boolean =>
    (grid.cells[row - 1]?.[col - 1]?.text ?? '') !== '';

  const columnEmpty = (col: number, range: CellRange): boolean => {
    for (let row = range.top; row <= range.bottom; row += 1) {
      if (filled(row, col)) return false;
    }
    return true;
  };

  const rowEmpty = (row: number, range: CellRange): boolean => {
    for (let col = range.left; col <= range.right; col += 1) {
      if (filled(row, col)) return false;
    }
    return true;
  };

  /** Shrinks a range inward past empty edges. Returns null if fully empty. */
  function trim(range: CellRange): CellRange | null {
    let { top, left, bottom, right } = range;
    while (top <= bottom && rowEmpty(top, { top, left, bottom, right })) top += 1;
    while (bottom >= top && rowEmpty(bottom, { top, left, bottom, right })) bottom -= 1;
    if (top > bottom) return null;
    while (left <= right && columnEmpty(left, { top, left, bottom, right })) left += 1;
    while (right >= left && columnEmpty(right, { top, left, bottom, right })) right -= 1;
    if (left > right) return null;
    return { top, left, bottom, right };
  }

  /** Runs of consecutive empty lines strictly inside the range, along one axis. */
  function gaps(range: CellRange, axis: Axis): Array<[number, number]> {
    const start = axis === 'vertical' ? range.left : range.top;
    const end = axis === 'vertical' ? range.right : range.bottom;
    const isEmpty = axis === 'vertical'
      ? (i: number) => columnEmpty(i, range)
      : (i: number) => rowEmpty(i, range);
    const minRun = axis === 'vertical' ? minGapCols : minGapRows;

    const runs: Array<[number, number]> = [];
    let runStart: number | null = null;

    for (let i = start; i <= end; i += 1) {
      if (isEmpty(i)) {
        if (runStart === null) runStart = i;
      } else if (runStart !== null) {
        if (i - runStart >= minRun) runs.push([runStart, i - 1]);
        runStart = null;
      }
    }
    return runs;
  }

  function splitOn(range: CellRange, axis: Axis, runs: Array<[number, number]>): void {
    const end = axis === 'vertical' ? range.right : range.bottom;
    let cursor = axis === 'vertical' ? range.left : range.top;

    const segments: Array<[number, number]> = [];
    for (const [runStart, runEnd] of runs) {
      if (runStart > cursor) segments.push([cursor, runStart - 1]);
      cursor = runEnd + 1;
    }
    if (cursor <= end) segments.push([cursor, end]);

    for (const [segStart, segEnd] of segments) {
      const sub: CellRange = axis === 'vertical'
        ? { ...range, left: segStart, right: segEnd }
        : { ...range, top: segStart, bottom: segEnd };
      cut(sub, other(axis), false);
    }
  }

  function cut(range: CellRange, axis: Axis, flipped: boolean): void {
    const trimmed = trim(range);
    if (!trimmed) return;

    const runs = gaps(trimmed, axis);
    if (runs.length > 0) {
      splitOn(trimmed, axis, runs);
      return;
    }
    if (!flipped) {
      cut(trimmed, other(axis), true);
      return;
    }
    blocks.push(trimmed);
  }

  if (grid.rowCount > 0 && grid.colCount > 0) {
    cut({ top: 1, left: 1, bottom: grid.rowCount, right: grid.colCount }, 'vertical', false);
  }
  return blocks;
}
