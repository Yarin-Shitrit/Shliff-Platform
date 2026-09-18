import { describe, it, expect } from 'vitest';
import { columnRows, type BlockShape } from './review';

/** A4:D9 — a header row and five data rows, with an empty column at C. */
const block: BlockShape = {
  top: 4, left: 1, right: 4, headerRow: 4,
  rawGrid: [
    ['תאריך', 'פירוט', '', 'יצא'],
    ['05/07/26', 'תשלום גנרטור', '', '4200'],
    ['', '', '', ''],
    ['08/07/26', 'קניות מטבח', '', '1860'],
    ['11/07/26', 'דלק', '', '640'],
    ['12/07/26', 'חבלים', '', '210'],
  ],
};

describe('columnRows', () => {
  it('gives each column its Excel letter, so reordering never loses the place', () => {
    const rows = columnRows(block, [{ column: 1, field: 'date', confidence: 1 }]);
    expect(rows.map((r) => r.label).sort()).toEqual(['A', 'B', 'D']);
  });

  it('takes three samples from below the header and skips the blank row', () => {
    const rows = columnRows(block, [{ column: 1, field: 'date', confidence: 1 }]);
    const date = rows.find((r) => r.label === 'A');
    expect(date?.samples).toEqual(['05/07/26', '08/07/26', '11/07/26']);
  });

  it('drops a column that has neither a header nor a value', () => {
    const rows = columnRows(block, []);
    expect(rows.some((r) => r.label === 'C')).toBe(false);
  });

  it('sorts the unsure first and keeps workbook order within a word', () => {
    const rows = columnRows(block, [
      { column: 1, field: 'date', confidence: 1 },
      { column: 2, field: 'description', confidence: 0.8 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['D', 'B', 'A']);
  });

  it('reports an unmapped column as having no field and no confidence', () => {
    const rows = columnRows(block, [{ column: 1, field: 'date', confidence: 1 }]);
    const outflow = rows.find((r) => r.label === 'D');
    expect(outflow?.field).toBeNull();
    expect(outflow?.confidence).toBeNull();
  });

  it('reads a block with no header row as all header-less, samples from the top', () => {
    const rows = columnRows({ ...block, headerRow: null }, []);
    expect(rows.find((r) => r.label === 'A')?.header).toBe('');
    expect(rows.find((r) => r.label === 'A')?.samples)
      .toEqual(['תאריך', '05/07/26', '08/07/26']);
  });
});
