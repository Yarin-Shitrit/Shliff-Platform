import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import type { CellRange } from '@/lib/blocks/types';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

function contains(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom
    && col >= range.left && col <= range.right;
}

function blockAt(blocks: CellRange[], row: number, col: number): CellRange | undefined {
  return blocks.find((b) => contains(b, row, col));
}

describe('detectBlocks', () => {
  let y26: SheetGrid[];
  let y25: SheetGrid[];

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y25 = await extractWorkbook(fixtureBuffer(FIXTURES.y25));
  });

  it('assigns every non-empty cell to exactly one block', () => {
    for (const grid of y26) {
      const blocks = detectBlocks(grid);
      for (let r = 1; r <= grid.rowCount; r += 1) {
        for (let c = 1; c <= grid.colCount; c += 1) {
          if (grid.cells[r - 1][c - 1].text === '') continue;
          const owners = blocks.filter((b) => contains(b, r, c));
          expect(owners.length, `cell r${r}c${c} in ${grid.name}`).toBe(1);
        }
      }
    }
  });

  it('produces no overlapping blocks', () => {
    for (const grid of [...y26, ...y25]) {
      const blocks = detectBlocks(grid);
      for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
          const a = blocks[i];
          const b = blocks[j];
          const overlaps = a.left <= b.right && b.left <= a.right
            && a.top <= b.bottom && b.top <= a.bottom;
          expect(overlaps, `${grid.name} blocks ${i}/${j}`).toBe(false);
        }
      }
    }
  });

  it('separates the ledger from the debt block in the 2026 סיכום כללי', () => {
    const summary = y26.find((s) => s.name === 'סיכום כללי')!;
    const blocks = detectBlocks(summary);

    const ledger = blockAt(blocks, 1, 1);      // A1 = תאריך
    const debt = blockAt(blocks, 1, 7);        // G1 = חוב יוסף

    expect(ledger).toBeDefined();
    expect(debt).toBeDefined();
    expect(ledger).not.toBe(debt);
    expect(ledger!.right).toBeLessThan(debt!.left);
  });

  it('separates the ledger from the account-balance block in the 25 סיכום כללי', () => {
    const summary = y25.find((s) => s.name === 'סיכום כללי')!;
    const blocks = detectBlocks(summary);

    const ledger = blockAt(blocks, 1, 1);      // A1 = תאריך
    const balances = blockAt(blocks, 1, 8);    // H1 = מיקום

    expect(ledger).toBeDefined();
    expect(balances).toBeDefined();
    expect(ledger).not.toBe(balances);
  });

  // SuperNature 18.7 holds six real tables (expense list, actual income,
  // cash-payer list, Bit-payer list, a two-partner expense split, and
  // offsets), but none of them is separated anywhere in the sheet by a
  // blank column or by a run of >= minGapRows blank rows: D2
  // ("שולם/ לא שולם", the expense table's own "paid/not paid" column) sits
  // immediately next to E2 ("אתר ווייבז", the income table's first
  // header) with zero empty columns between them, and this holds at
  // every row band in the sheet, not just row 2. A whitespace-based
  // XY-cut cannot produce a cut that does not exist in the data, so it
  // degrades gracefully to one larger block, per the design (see the
  // project spec's "degrades gracefully" clause), leaving the six
  // sub-tables for an admin to split by hand in the review UI rather than
  // guessing wrong boundaries.
  it('merges SuperNature 18.7 into one block because no gap separates its tables', () => {
    const sheet = y26.find((s) => s.name === 'SuperNature 18.7')!;
    const blocks = detectBlocks(sheet);

    const expenses = blockAt(blocks, 1, 1);    // A1 = הוצאות
    const income = blockAt(blocks, 1, 5);      // E1 = הכנסות בפועל

    expect(blocks.length).toBe(1);
    expect(expenses).toBe(income);
  });

  it('keeps the budget line items together despite a single blank row', () => {
    const budget = y26.find((s) => s.name === 'תקציב קאמפ ברן 26')!;
    const blocks = detectBlocks(budget);

    const firstItem = blockAt(blocks, 3, 1);   // A3 = שירותים נסורת
    const lastItem = blockAt(blocks, 26, 1);   // A26 = 30 מ׳ לייקרה...

    expect(firstItem).toBeDefined();
    expect(firstItem).toBe(lastItem);
  });

  it('returns no blocks for an entirely empty grid', () => {
    const empty: SheetGrid = {
      name: 'empty', index: 0, rowCount: 3, colCount: 3,
      cells: Array.from({ length: 3 }, (_, r) =>
        Array.from({ length: 3 }, (_, c) => ({
          row: r + 1, col: c + 1, value: null, text: '', isMerged: false,
        })),
      ),
    };
    expect(detectBlocks(empty)).toEqual([]);
  });
});
