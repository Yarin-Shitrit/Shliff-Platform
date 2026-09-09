import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { mapColumns, findHeaderRow } from '@/lib/classify/map-columns';
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

describe('mapColumns', () => {
  let y26: SheetGrid[];
  let y2324: SheetGrid[];

  const sheet = (sheets: SheetGrid[], name: string): SheetGrid => {
    const found = sheets.find((s) => s.name === name);
    if (!found) throw new Error(`missing sheet ${name}`);
    return found;
  };

  beforeAll(async () => {
    y26 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    y2324 = await extractWorkbook(fixtureBuffer(FIXTURES.y2324));
  });

  it('finds the header row of the 2026 ledger', () => {
    const summary = sheet(y26, 'סיכום כללי');
    const range = blockAt(detectBlocks(summary), 1, 1);
    expect(findHeaderRow(summary, range)).toBe(1);
  });

  it('maps the ledger columns to canonical fields', () => {
    const summary = sheet(y26, 'סיכום כללי');
    const range = blockAt(detectBlocks(summary), 1, 1);
    const { mappings } = mapColumns(summary, range, 'ledger');
    const field = (col: number) => mappings.find((m) => m.column === col)?.field;

    expect(field(1)).toBe('date');
    expect(field(2)).toBe('outflow');
    expect(field(3)).toBe('inflow');
    expect(field(4)).toBe('description');
  });

  it('maps budget columns to canonical fields', () => {
    const budget = sheet(y26, 'תקציב קאמפ ברן 26');
    const range = blockAt(detectBlocks(budget), 2, 1);
    const { mappings } = mapColumns(budget, range, 'budget_lines');
    const field = (col: number) => mappings.find((m) => m.column === col)?.field;

    expect(field(1)).toBe('item');
    expect(field(2)).toBe('quantity');
    expect(field(3)).toBe('unit_cost');
    expect(field(4)).toBe('total');
  });

  it('maps ticket rounds correctly when quantity precedes price (Gagarin)', () => {
    const gagarin = sheet(y2324, 'Shliff Gagarin 20.01');
    const range = blockAt(detectBlocks(gagarin), 2, 1);
    const { mappings } = mapColumns(gagarin, range, 'ticket_rounds');
    const col = (f: string) => mappings.find((m) => m.field === f)?.column;

    expect(col('quantity')).toBeLessThan(col('price')!);
  });

  it('maps ticket rounds correctly when price precedes quantity (Collabo)', () => {
    const collabo = sheet(y2324, 'Shliff Collabo #3');
    const range = blockAt(detectBlocks(collabo), 2, 1);
    const { mappings } = mapColumns(collabo, range, 'ticket_rounds');
    const col = (f: string) => mappings.find((m) => m.field === f)?.column;

    expect(col('price')).toBeLessThan(col('quantity')!);
  });

  it('returns a null header row for a block with no header', () => {
    const grid: SheetGrid = {
      name: 'bare', index: 0, rowCount: 2, colCount: 2,
      cells: [
        [
          { row: 1, col: 1, value: 100, text: '100', isMerged: false },
          { row: 1, col: 2, value: 200, text: '200', isMerged: false },
        ],
        [
          { row: 2, col: 1, value: 300, text: '300', isMerged: false },
          { row: 2, col: 2, value: 400, text: '400', isMerged: false },
        ],
      ],
    };
    expect(findHeaderRow(grid, { top: 1, left: 1, bottom: 2, right: 2 })).toBeNull();
  });
});
