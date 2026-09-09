import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { findHeaderRow } from '@/lib/classify/header';
import { layoutFingerprint } from '@/lib/classify/signature';
import type { CellRange } from '@/lib/blocks/types';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

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
