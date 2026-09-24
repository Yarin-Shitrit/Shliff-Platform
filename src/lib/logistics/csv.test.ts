import { describe, it, expect } from 'vitest';
import type { WarehouseRow } from './warehouse';
import type { AcquisitionRow } from './acquisitions';
import { csvCell, csvDocument, warehouseCsvRows, acquisitionsCsvRows } from './csv';

function item(over: Partial<WarehouseRow> = {}): WarehouseRow {
  return {
    id: 'i1', name: 'סיר תעשייתי', category: 'kitchen', quantity: 2,
    locationText: 'ארגז כחול #1', condition: 'ready', notes: null,
    updatedBy: 'lead@shliff.camp', updatedAt: new Date('2026-09-14T10:00:00Z'),
    ...over,
  };
}

function order(over: Partial<AcquisitionRow> = {}): AcquisitionRow {
  return {
    seasonId: 's26', id: 'a1', name: 'מקדחה רוטטת', category: 'build', quantityNeeded: 1,
    source: 'buy_new', estimatedAgorot: 40000, actualAgorot: 38000,
    assignee: { id: 'p1', name: 'איתי כהן' }, lender: null,
    budgetLineId: null, arrivedItemId: null, status: 'ordered',
    updatedAt: new Date('2026-09-14T10:00:00Z'), updatedBy: null,
    ...over,
  };
}

describe('escaping a cell', () => {
  it('quotes every field, so a comma in a name is not a new column', () => {
    expect(csvCell('בנייה, כלים ותשתיות')).toBe('"בנייה, כלים ותשתיות"');
  });

  it('doubles a quote rather than ending the field early', () => {
    expect(csvCell('ארגז "גדול"')).toBe('"ארגז ""גדול"""');
  });

  it('defuses a cell that a spreadsheet would run as a formula', () => {
    // Excel and Sheets execute a cell beginning =, +, - or @ when the file is
    // opened. An item named by somebody else is untrusted input, and this is
    // the one place it reaches another program.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(csvCell(dangerous).startsWith('"\'')).toBe(true);
    }
  });

  it('leaves an ordinary Hebrew name alone', () => {
    expect(csvCell('סיר תעשייתי')).toBe('"סיר תעשייתי"');
  });
});

describe('the file itself', () => {
  it('starts with a BOM, or Excel renders the Hebrew as mojibake', () => {
    expect(csvDocument([['שם']]).startsWith('﻿')).toBe(true);
  });

  it('separates rows with CRLF, which is what Excel expects', () => {
    expect(csvDocument([['א'], ['ב']])).toContain('\r\n');
  });
});

describe('the warehouse export', () => {
  it('names every column in Hebrew', () => {
    const [header] = warehouseCsvRows([]);
    for (const cell of header) expect(cell).not.toMatch(/[A-Za-z]/);
  });

  it('carries the provenance into the file, not just onto the screen', () => {
    // R11. A spreadsheet that has left the app is exactly where a number
    // loses its source, and this column is what stops the export coming back
    // as an import nobody can account for.
    const [, row] = warehouseCsvRows([item()]);
    expect(row).toContain('נרשם ידנית');
  });

  it('writes the state in words, the same words the screen uses', () => {
    const [, row] = warehouseCsvRows([item({ condition: 'needs_repair' })]);
    expect(row).toContain('דורש תיקון');
  });

  it('leaves a missing location empty rather than writing a dash', () => {
    // The screen's `—` is a reading aid. In a spreadsheet it is a value, and
    // a column of dashes cannot be filtered or counted.
    const [, row] = warehouseCsvRows([item({ locationText: null })]);
    expect(row[3]).toBe('');
  });
});

describe('the acquisitions export', () => {
  it('writes amounts as numbers a spreadsheet can sum', () => {
    // `4,850 ₪` is text. A column that cannot be totalled is the reason
    // somebody would go back to the workbook this platform replaced.
    const [, row] = acquisitionsCsvRows([order()], 'ברן 26');
    expect(row[5]).toBe('400.00');
    expect(row[6]).toBe('380.00');
  });

  it('keeps "nobody priced it" empty rather than zero', () => {
    // A zero is a figure somebody could total, and it would claim the camp
    // expects the thing to be free.
    const [, row] = acquisitionsCsvRows([order({ estimatedAgorot: null, actualAgorot: null })], 'ברן 26');
    expect(row[5]).toBe('');
    expect(row[6]).toBe('');
  });

  it('names the lender, because a borrowed thing has to go back', () => {
    const [, row] = acquisitionsCsvRows([
      order({ source: 'borrow_member', lender: { id: 'p2', name: 'מיכל רוזן' } }),
    ], 'ברן 26');
    expect(row).toContain('מיכל רוזן');
  });

  it('has a header for every column it writes', () => {
    const [header, row] = acquisitionsCsvRows([order()], 'ברן 26');
    expect(row).toHaveLength(header.length);
  });

  it('says which rows are camp-wide, and names the season for the rest', () => {
    // The file is exported for one year, and a camp-wide row is in it because
    // it belongs to every year. Without the column, a generator needed every
    // burn reads as one more thing this year's list asked for.
    const [, own, shared] = acquisitionsCsvRows([
      order(), order({ id: 'a2', name: 'גנרטור', seasonId: null }),
    ], 'ברן 26');
    expect(own[1]).toBe('ברן 26');
    expect(shared[1]).toBe('כלל־קאמפי');
  });
});
