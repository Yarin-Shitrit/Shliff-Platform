import { describe, it, expect } from 'vitest';
import { blockRows, isTotalRow, isCarryForward, isBlankRow } from './rows';

const BLOCK = {
  top: 5,
  left: 2,
  headerRow: 5,
  rawGrid: [
    ['תאריך', 'פירוט', 'הוצאות', 'הכנסות'],
    ['20/05/2025', 'מקדמה מייצג', '4000', ''],
    ['', '', '', ''],
    ['סה"כ', '', '4000', ''],
  ],
};

const MAP = [
  { column: 2, field: 'date', confidence: 1 },
  { column: 3, field: 'description', confidence: 1 },
  { column: 4, field: 'outflow', confidence: 1 },
  { column: 5, field: 'inflow', confidence: 1 },
];

describe('blockRows', () => {
  it('numbers rows by absolute sheet row, not by index in the block', () => {
    const rows = blockRows(BLOCK, MAP);
    expect(rows[0].sheetRow).toBe(6);
    expect(rows.at(-1)?.sheetRow).toBe(8);
  });

  it('skips the header row', () => {
    const rows = blockRows(BLOCK, MAP);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sheetRow > 5)).toBe(true);
  });

  it('maps cells by sheet column, offset by the block left edge', () => {
    const [first] = blockRows(BLOCK, MAP);
    expect(first.cells.date).toBe('20/05/2025');
    expect(first.cells.description).toBe('מקדמה מייצג');
    expect(first.cells.outflow).toBe('4000');
    expect(first.cells.inflow).toBe('');
  });

  it('keeps the raw row alongside the mapped cells', () => {
    const [first] = blockRows(BLOCK, MAP);
    expect(first.raw).toEqual(['20/05/2025', 'מקדמה מייצג', '4000', '']);
  });

  it('treats every row as data when there is no header row', () => {
    const rows = blockRows({ ...BLOCK, headerRow: null }, MAP);
    expect(rows).toHaveLength(4);
    expect(rows[0].sheetRow).toBe(5);
  });
});

describe('row classifiers', () => {
  it('detects a סה"כ row regardless of quote style', () => {
    expect(isTotalRow(['סה"כ', '', '4000'])).toBe(true);
    expect(isTotalRow(['סה״כ', '', '4000'])).toBe(true);
    expect(isTotalRow(['מקדמה מייצג', '', '4000'])).toBe(false);
  });

  it('detects the carry-forward line', () => {
    expect(isCarryForward(['מעבר לקובץ חדש', '', '44647'])).toBe(true);
    expect(isCarryForward(['מסיבת פקאנים', '', '57000'])).toBe(false);
  });

  it('treats a row of only invisible marks as blank', () => {
    expect(isBlankRow(['', '  ', '‏'])).toBe(true);
    expect(isBlankRow(['', '', '0'])).toBe(false);
  });
});
