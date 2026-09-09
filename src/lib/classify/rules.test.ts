import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { classifyBlock } from '@/lib/classify/rules';
import type { CellRange } from '@/lib/blocks/types';
import type { Cell, SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

/** Builds a minimal single-block SheetGrid from a row-major grid of cell text,
 * for tests that need precise control over exactly what text is present
 * rather than depending on fixture content. */
function buildGrid(rows: string[][]): SheetGrid {
  const rowCount = rows.length;
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const cells: Cell[][] = rows.map((row, r) =>
    Array.from({ length: colCount }, (_, c): Cell => {
      const text = row[c] ?? '';
      return { row: r + 1, col: c + 1, value: text === '' ? null : text, text, isMerged: false };
    }),
  );
  return { name: 'synthetic', index: 0, rowCount, colCount, cells };
}

function fullRange(grid: SheetGrid): CellRange {
  return { top: 1, left: 1, bottom: grid.rowCount, right: grid.colCount };
}

function blockAt(blocks: CellRange[], row: number, col: number): CellRange {
  const found = blocks.find(
    (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right,
  );
  if (!found) throw new Error(`no block at r${row}c${col}`);
  return found;
}

function archetypeAt(grid: SheetGrid, row: number, col: number): string {
  const range = blockAt(detectBlocks(grid), row, col);
  return classifyBlock(grid, range).archetype;
}

describe('classifyBlock', () => {
  let y26: SheetGrid[];
  let y25: SheetGrid[];
  let y2324: SheetGrid[];

  const sheet = (sheets: SheetGrid[], name: string): SheetGrid => {
    const found = sheets.find((s) => s.name === name);
    if (!found) throw new Error(`missing sheet ${name}`);
    return found;
  };

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y25 = await extractWorkbook(fixtureBuffer(FIXTURES.y25));
    y2324 = await extractWorkbook(fixtureBuffer(FIXTURES.y2324));
  });

  it('classifies the 2026 cashbox ledger', () => {
    expect(archetypeAt(sheet(y26, 'סיכום כללי'), 1, 1)).toBe('ledger');
  });

  it('classifies the 23-24 day2day ledger despite English sheet naming', () => {
    expect(archetypeAt(sheet(y2324, 'Shliff day2day spending'), 1, 1)).toBe('ledger');
  });

  it('classifies the camp budget line items', () => {
    expect(archetypeAt(sheet(y26, 'תקציב קאמפ ברן 26'), 2, 1)).toBe('budget_lines');
    expect(archetypeAt(sheet(y25, 'תקציב קאמפ ברן 25'), 2, 1)).toBe('budget_lines');
  });

  it('classifies ticket rounds regardless of column order', () => {
    // Gagarin: qty then price. Collabo: price then qty.
    expect(archetypeAt(sheet(y2324, 'Shliff Gagarin 20.01'), 2, 1)).toBe('ticket_rounds');
    expect(archetypeAt(sheet(y2324, 'Shliff Collabo #3'), 2, 1)).toBe('ticket_rounds');
  });

  it('classifies the account-balance block in the 25 summary', () => {
    expect(archetypeAt(sheet(y25, 'סיכום כללי'), 1, 8)).toBe('account_balances');
  });

  it('classifies an income-channel block', () => {
    expect(archetypeAt(sheet(y25, 'House of trance 270925'), 2, 4)).toBe('income_channels');
  });

  it('reports low confidence rather than a wrong archetype for unlabelled blocks', () => {
    const deco = sheet(y2324, 'Shliff Deco 24');
    const range = blockAt(detectBlocks(deco), 2, 1);
    const result = classifyBlock(deco, range);
    if (result.archetype === 'unknown') {
      expect(result.confidence).toBeLessThan(0.5);
    } else {
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  it('returns a confidence between 0 and 1', () => {
    const summary = sheet(y26, 'סיכום כללי');
    const result = classifyBlock(summary, blockAt(detectBlocks(summary), 1, 1));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  describe('single-word term matching', () => {
    it('does not let a single-word term match as a substring of an unrelated word', () => {
      // 'ביט' (income_channels, weight 3) must not match inside 'ביטים'
      // ("drill bits"); 'בר' (weight 1) must not match inside 'ברגים'
      // ("screws") or 'חבר' ("member"). Under plain substring matching all
      // three would false-positive.
      const grid = buildGrid([['ביטים', 'ברגים', 'חבר']]);
      const result = classifyBlock(grid, fullRange(grid));
      expect(result.scores.income_channels).toBe(0);
    });

    it('still matches a single-word term as a standalone token', () => {
      const grid = buildGrid([['ביט', 'תיאור', 'סכום']]);
      const result = classifyBlock(grid, fullRange(grid));
      expect(result.scores.income_channels).toBeGreaterThan(0);
      expect(result.archetype).toBe('income_channels');
    });
  });

  describe('confidence calibration', () => {
    it('keeps confidence below the pre-confirm threshold for a single weak signal', () => {
      // 'פירוט' alone (ledger, weight 1): uncontested, but almost no evidence.
      const grid = buildGrid([['פירוט']]);
      const result = classifyBlock(grid, fullRange(grid));
      expect(result.archetype).toBe('ledger');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('keeps confidence below the pre-confirm threshold when the top two archetypes tie', () => {
      // 'פירוט' (ledger, weight 1) vs 'שולם' (event_lines, weight 1): exact tie.
      const grid = buildGrid([['פירוט', 'שולם']]);
      const result = classifyBlock(grid, fullRange(grid));
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('reaches the pre-confirm threshold when corroborating signals dominate', () => {
      // ledger: תאריך(3) + תיאור תנועה(4) + הוצאות(1) = 8, uncontested.
      const grid = buildGrid([['תאריך', 'תיאור תנועה', 'הוצאות']]);
      const result = classifyBlock(grid, fullRange(grid));
      expect(result.archetype).toBe('ledger');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });
});
