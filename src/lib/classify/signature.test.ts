import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { findHeaderRow } from '@/lib/classify/header';
import { layoutFingerprint } from '@/lib/classify/signature';
import type { CellRange } from '@/lib/blocks/types';
import type { Cell, SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

/**
 * A single header row, one cell per given string ('' for a blank cell), as
 * its own full-width range. Only the header row itself matters to
 * layoutFingerprint, so no data row is needed.
 */
function headerGrid(headerTexts: string[]): { grid: SheetGrid; range: CellRange } {
  const row: Cell[] = headerTexts.map((text, i) => ({
    row: 1,
    col: i + 1,
    value: text === '' ? null : text,
    text,
    isMerged: false,
  }));
  const grid: SheetGrid = {
    name: 'synthetic',
    index: 0,
    rowCount: 1,
    colCount: headerTexts.length,
    cells: [row],
  };
  const range: CellRange = { top: 1, left: 1, bottom: 1, right: headerTexts.length };
  return { grid, range };
}

function blockAt(blocks: CellRange[], row: number, col: number): CellRange {
  const found = blocks.find(
    (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right,
  );
  if (!found) throw new Error(`no block at r${row}c${col}`);
  return found;
}

function fingerprintOf(grid: SheetGrid, row: number, col: number): string {
  const range = blockAt(detectBlocks(grid), row, col);
  return layoutFingerprint(grid, range, findHeaderRow(grid, range));
}

describe('layoutFingerprint', () => {
  let y26: SheetGrid[];
  let y25: SheetGrid[];

  const sheet = (sheets: SheetGrid[], name: string): SheetGrid => {
    const found = sheets.find((s) => s.name === name);
    if (!found) throw new Error(`missing sheet ${name}`);
    return found;
  };

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y25 = await extractWorkbook(fixtureBuffer(FIXTURES.y25));
  });

  it('returns a stable 32-character hex string', () => {
    const fp = fingerprintOf(sheet(y26, 'סיכום כללי'), 1, 1);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintOf(sheet(y26, 'סיכום כללי'), 1, 1)).toBe(fp);
  });

  it('matches the same layout across two different workbooks', () => {
    // תקציב קאמפ ברן 26 appears in both the 25 and 2026 files with identical headers.
    const fromY26 = fingerprintOf(sheet(y26, 'תקציב קאמפ ברן 26'), 2, 1);
    const fromY25 = fingerprintOf(sheet(y25, 'תקציב קאמפ ברן 26'), 2, 1);
    expect(fromY26).toBe(fromY25);
  });

  it('differs between different layouts', () => {
    const ledger = fingerprintOf(sheet(y26, 'סיכום כללי'), 1, 1);
    const budget = fingerprintOf(sheet(y26, 'תקציב קאמפ ברן 26'), 2, 1);
    expect(ledger).not.toBe(budget);
  });

  it('is insensitive to Hebrew punctuation variants', () => {
    const grid = (header: string): SheetGrid => ({
      name: 't', index: 0, rowCount: 2, colCount: 1,
      cells: [
        [{ row: 1, col: 1, value: header, text: header, isMerged: false }],
        [{ row: 2, col: 1, value: 1, text: '1', isMerged: false }],
      ],
    });
    const range: CellRange = { top: 1, left: 1, bottom: 2, right: 1 };
    expect(layoutFingerprint(grid('סה״כ'), range, 1))
      .toBe(layoutFingerprint(grid('סה"כ'), range, 1));
  });
});

// The leading-header-run boundary is the load-bearing, non-brief part of this
// file (it's what makes the ברן 26 cross-workbook fixture test above pass at
// all — see signature.ts's docstring). These pin its edge cases directly with
// hand-built grids, rather than relying on real fixtures happening to exercise
// them, per the project's prior curly-quote-regex lesson: a real gap can ship
// green if no test happens to use the character/shape that would expose it.
describe('layoutFingerprint — header-run boundary (synthetic)', () => {
  it('stops the header run at a mid-run blank cell, so trailing columns do not affect the fingerprint', () => {
    const trimmed = headerGrid(['a', 'b']);
    const withTrailing = headerGrid(['a', 'b', '', 'anything', 'goes', 'here']);
    expect(layoutFingerprint(withTrailing.grid, withTrailing.range, 1))
      .toBe(layoutFingerprint(trimmed.grid, trimmed.range, 1));
  });

  it('treats two blocks with matching leading headers as the same layout even when content past the blank column differs — a deliberate, documented collision, not an accidental one', () => {
    const gagarinLike = headerGrid(['כמות', 'מחיר', '', 'קארינה', 'שולם']);
    const collaboLike = headerGrid(['כמות', 'מחיר', '', 'ירין', 'לא שולם', 'extra']);
    expect(layoutFingerprint(gagarinLike.grid, gagarinLike.range, 1))
      .toBe(layoutFingerprint(collaboLike.grid, collaboLike.range, 1));
  });

  it('is stable and well-formed when there is no header row at all', () => {
    const { grid, range } = headerGrid(['100', '200', '300']);
    const fp1 = layoutFingerprint(grid, range, null);
    const fp2 = layoutFingerprint(grid, range, null);
    expect(fp1).toMatch(/^[0-9a-f]{32}$/);
    expect(fp1).toBe(fp2);
  });

  it('falls back to hashing the full range — not an empty header list — when the first header cell is itself blank', () => {
    const same = headerGrid(['', 'b', 'c']);
    const sameAgain = headerGrid(['', 'b', 'c']);
    expect(layoutFingerprint(same.grid, same.range, 1))
      .toBe(layoutFingerprint(sameAgain.grid, sameAgain.range, 1));

    // If the fallback collapsed to an empty header list instead, these two
    // would collide despite genuinely different content — proving the
    // fallback actually hashes the range rather than discarding it.
    const different = headerGrid(['', 'x', 'y']);
    expect(layoutFingerprint(same.grid, same.range, 1))
      .not.toBe(layoutFingerprint(different.grid, different.range, 1));
  });
});
