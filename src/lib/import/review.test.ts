import { describe, it, expect } from 'vitest';
import {
  columnRows, gridRows, blockRefusal, summarise, nextUnreviewed, mappingKey,
  reviewStep, type BlockShape,
} from './review';
import type { PromotionResult } from '@/lib/import/promote/types';

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

const grid = { top: 3, headerRow: 3, rawGrid: [
  ['תאריך', 'פירוט', 'יצא', 'נכנס'],
  ['05/07/26', 'תשלום גנרטור', '4200', ''],
  ['14/07/26', 'נועה ל.', '', '1200'],
  ['', 'סה״כ', '6700', '4700'],
] };

const result = {
  written: [
    { table: 'ledger_entries' as const, sheetRow: 4, id: null,
      summary: 'תשלום גנרטור', notes: [] },
    { table: 'ledger_entries' as const, sheetRow: 5, id: null, summary: 'נועה ל.',
      notes: ['השם ״נועה ל.״ לא זוהה — נשמר כטקסט וממתין לקישור'] },
  ],
  refused: [
    { sheetRow: 6, reason: 'total-row' as const,
      message: 'שורת סה״כ היא סכום מחושב, לא תנועה', cells: ['', 'סה״כ', '6700', '4700'] },
  ],
};

describe('gridRows', () => {
  it('keeps the header out of the written/refused reckoning', () => {
    expect(gridRows(grid, result)[0]).toMatchObject({ sheetRow: 3, state: 'header' });
  });

  it('numbers every row by its absolute position in the sheet', () => {
    expect(gridRows(grid, result).map((r) => r.sheetRow)).toEqual([3, 4, 5, 6]);
  });

  it('marks a row written with a note, and carries the note verbatim', () => {
    const noted = gridRows(grid, result)[2];
    expect(noted.state).toBe('noted');
    expect(noted.message).toBe('השם ״נועה ל.״ לא זוהה — נשמר כטקסט וממתין לקישור');
  });

  it('puts the refusal in place, in the promoter’s own Hebrew', () => {
    const refused = gridRows(grid, result)[3];
    expect(refused.state).toBe('refused');
    expect(refused.message).toBe('שורת סה״כ היא סכום מחושב, לא תנועה');
  });

  it('never hides a whole-block refusal inside the header row', () => {
    const whole = { written: [], refused: [{
      sheetRow: 3, reason: 'unconfirmed' as const,
      message: 'הטבלה עוד לא אושרה', cells: [],
    }] };
    expect(gridRows(grid, whole).every((r) => r.state !== 'refused')).toBe(true);
    expect(blockRefusal(whole)?.message).toBe('הטבלה עוד לא אושרה');
    expect(blockRefusal(result)).toBeNull();
  });
});

describe('summarise', () => {
  it('adds up four blocks into the shape promoteAll reports', () => {
    const one: PromotionResult = {
      blockId: 'b1', archetype: 'ledger', dryRun: true,
      written: result.written, refused: result.refused,
      deleted: 2, retained: [{ table: 'ledger_entries', id: 'r1', sheetRow: 9,
        reason: 'שורה זו נסגרה מול תשלום' }],
    };
    expect(summarise([one, { ...one, blockId: 'b2' }])).toEqual({
      blocks: 2, written: 4, noted: 2, refused: 2, deleted: 4, retained: 2,
    });
  });

  it('is zero for nothing, not NaN', () => {
    expect(summarise([])).toEqual({
      blocks: 0, written: 0, noted: 0, refused: 0, deleted: 0, retained: 0,
    });
  });
});

describe('nextUnreviewed', () => {
  const rail = [
    { blockId: 'a', state: 'confirmed' as const },
    { blockId: 'b', state: 'needs-review' as const },
    { blockId: 'c', state: 'promoted' as const },
    { blockId: 'd', state: 'recognised' as const },
  ];

  it('opens the next block still wanting a human', () => {
    expect(nextUnreviewed(rail, 'b')).toBe('d');
  });

  it('wraps to the start rather than stopping at the end', () => {
    expect(nextUnreviewed(rail, 'd')).toBe('b');
  });

  it('never returns the block just confirmed', () => {
    expect(nextUnreviewed(
      [{ blockId: 'b', state: 'needs-review' }], 'b',
    )).toBeNull();
  });
});

describe('mappingKey', () => {
  it('changes when the server recomputed the map for a new archetype', () => {
    const ledger = mappingKey('ledger', [{ column: 1, field: 'date', confidence: 1 }]);
    const budget = mappingKey('budget_lines', [{ column: 1, field: 'item', confidence: 1 }]);
    expect(ledger).not.toBe(budget);
  });

  it('does not change when only the order of the same mappings changed', () => {
    const a = mappingKey('ledger', [
      { column: 1, field: 'date', confidence: 1 },
      { column: 3, field: 'outflow', confidence: 1 },
    ]);
    const b = mappingKey('ledger', [
      { column: 3, field: 'outflow', confidence: 1 },
      { column: 1, field: 'date', confidence: 1 },
    ]);
    expect(a).toBe(b);
  });
});

describe('reviewStep', () => {
  it('sits on step 1 while the workbook is still being read', () => {
    expect(reviewStep({ status: 'pending' }, [])).toBe(1);
    expect(reviewStep({ status: 'failed' }, [])).toBe(1);
  });

  it('sits on step 2 when a parsed workbook produced no table', () => {
    expect(reviewStep({ status: 'parsed' }, [])).toBe(2);
  });

  it('sits on step 3 while any block still wants a decision', () => {
    expect(reviewStep({ status: 'parsed' }, [
      { state: 'promoted' }, { state: 'needs-review' },
    ])).toBe(3);
  });

  it('reaches step 4 only when nothing is left to decide', () => {
    expect(reviewStep({ status: 'parsed' }, [
      { state: 'promoted' }, { state: 'no-promoter' }, { state: 'superseded' },
    ])).toBe(4);
  });
});
