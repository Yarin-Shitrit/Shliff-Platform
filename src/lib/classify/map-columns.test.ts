import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import { detectBlocks } from '@/lib/blocks/detect';
import { mapColumns, findHeaderRow } from '@/lib/classify/map-columns';
import type { CellRange } from '@/lib/blocks/types';
import type { Cell, SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

function blockAt(blocks: CellRange[], row: number, col: number): CellRange {
  const found = blocks.find(
    (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right,
  );
  if (!found) throw new Error(`no block at r${row}c${col}`);
  return found;
}

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

  describe('single-word term matching', () => {
    it('does not let a single-word FIELD_TERMS entry match as a substring of an unrelated word', () => {
      // 'שם' (member_dues.person, obligations.party) must not match inside
      // 'בושם' ("perfume"); 'ספק' (event_lines.supplier) must not match
      // inside 'אספקה' ("supply"). Under plain substring matching both
      // would false-positive.
      const grid = buildGrid([
        ['בושם', 'אספקה'],
        ['100', '200'],
      ]);

      const memberDues = mapColumns(grid, fullRange(grid), 'member_dues');
      expect(memberDues.mappings.find((m) => m.field === 'person')).toBeUndefined();

      const eventLines = mapColumns(grid, fullRange(grid), 'event_lines');
      expect(eventLines.mappings.find((m) => m.field === 'supplier')).toBeUndefined();
    });

    it('still matches a single-word FIELD_TERMS entry as a standalone token', () => {
      const grid = buildGrid([
        ['שם', 'ספק'],
        ['100', '200'],
      ]);

      const memberDues = mapColumns(grid, fullRange(grid), 'member_dues');
      expect(memberDues.mappings.find((m) => m.field === 'person')?.column).toBe(1);

      const eventLines = mapColumns(grid, fullRange(grid), 'event_lines');
      expect(eventLines.mappings.find((m) => m.field === 'supplier')?.column).toBe(2);
    });
  });

  it('maps a תאריך header on an obligations block to date', () => {
    const grid = buildGrid([
      ['תאריך', 'שם', 'פירוט', 'סכום'],
      ['20/05/2025', 'יוסף', 'חוב יוסף', '15240'],
    ]);
    const { mappings } = mapColumns(grid, fullRange(grid), 'obligations');
    const field = (col: number) => mappings.find((m) => m.column === col)?.field;

    expect(field(1)).toBe('date');
    expect(field(2)).toBe('party');
    expect(field(3)).toBe('description');
    expect(field(4)).toBe('amount');
  });

  describe('header run alignment', () => {
    it('maps only the columns in the leading contiguous run of non-blank header cells', () => {
      // Column 3's header is blank, so column 4 sits outside the header run
      // signature.ts's layoutFingerprint hashes — mapColumns must not map it
      // either, even though its text ("הכנסות") would otherwise match.
      const grid = buildGrid([
        ['תאריך', 'הוצאות', '', 'הכנסות'],
        ['100', '5000', '', '3000'],
      ]);
      const { mappings } = mapColumns(grid, fullRange(grid), 'ledger');
      const field = (col: number) => mappings.find((m) => m.column === col)?.field;

      expect(field(1)).toBe('date');
      expect(field(2)).toBe('outflow');
      expect(field(4)).toBeUndefined();
      expect(mappings).toHaveLength(2);
    });
  });

  describe('explicit headerRow', () => {
    // A merged decorative title mirrors its text onto every column it spans
    // (ExcelJS's own behavior). `findHeaderRow` only recognizes that as one
    // label, not one per column, when `isMerged` is set — a grid rebuilt from
    // a block's stored, text-only rawGrid (confirm.ts's gridFromBlock) can
    // never set it. Without `isMerged`, the title scores the same 4 text
    // cells as the real header below it, and the earliest-row-wins tiebreak
    // in findHeaderRow picks the title instead.
    const grid: SheetGrid = {
      name: 'ticket rounds', index: 0, rowCount: 3, colCount: 4,
      cells: [
        [
          { row: 1, col: 1, value: 'כותרת', text: 'כותרת', isMerged: false },
          { row: 1, col: 2, value: 'כותרת', text: 'כותרת', isMerged: false },
          { row: 1, col: 3, value: 'כותרת', text: 'כותרת', isMerged: false },
          { row: 1, col: 4, value: 'כותרת', text: 'כותרת', isMerged: false },
        ],
        [
          { row: 2, col: 1, value: 'סוג כרטיס', text: 'סוג כרטיס', isMerged: false },
          { row: 2, col: 2, value: 'כמות כרטיס', text: 'כמות כרטיס', isMerged: false },
          { row: 2, col: 3, value: 'מחיר כרטיס', text: 'מחיר כרטיס', isMerged: false },
          { row: 2, col: 4, value: 'סה"כ', text: 'סה"כ', isMerged: false },
        ],
        [
          { row: 3, col: 1, value: 'בוקר', text: 'בוקר', isMerged: false },
          { row: 3, col: 2, value: 50, text: '50', isMerged: false },
          { row: 3, col: 3, value: 20, text: '20', isMerged: false },
          { row: 3, col: 4, value: 1000, text: '1000', isMerged: false },
        ],
      ],
    };
    const range: CellRange = { top: 1, left: 1, bottom: 3, right: 4 };

    it('without it, detection is fooled by the unmerged title row (the failure this parameter exists to route around)', () => {
      expect(mapColumns(grid, range, 'ticket_rounds').headerRow).toBe(1);
    });

    it('uses the given headerRow instead of detecting one', () => {
      const { headerRow, mappings } = mapColumns(grid, range, 'ticket_rounds', 2);
      expect(headerRow).toBe(2);
      expect(mappings.map((m) => m.field).sort()).toEqual(['price', 'quantity', 'round', 'total']);
    });

    it('falls back to detecting a header row when none is given', () => {
      const plain = buildGrid([
        ['תאריך', 'הוצאות', 'הכנסות'],
        ['100', '5000', '3000'],
      ]);
      expect(mapColumns(plain, fullRange(plain), 'ledger').headerRow).toBe(1);
    });
  });
});
