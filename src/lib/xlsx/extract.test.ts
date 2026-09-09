import { describe, it, expect, beforeAll } from 'vitest';
import { extractWorkbook } from '@/lib/xlsx/extract';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

describe('extractWorkbook', () => {
  let sheets2026: SheetGrid[];

  beforeAll(async () => {
    sheets2026 = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
  });

  it('extracts every sheet in order', () => {
    expect(sheets2026.map((s) => s.name)).toEqual([
      'סיכום כללי',
      'תקציב קאמפ ברן 26',
      'תקציב קאמפ ברן 25',
      'SuperNature 18.7',
      'SuperNature 3.10',
    ]);
  });

  it('uses 1-indexed coordinates addressable as cells[row-1][col-1]', () => {
    const summary = sheets2026[0];
    const a1 = summary.cells[0][0];
    expect(a1.row).toBe(1);
    expect(a1.col).toBe(1);
    expect(a1.text).toBe('תאריך');
  });

  it('reads Hebrew headers across the row', () => {
    const summary = sheets2026[0];
    expect(summary.cells[0][1].text).toBe('הוצאות');
    expect(summary.cells[0][2].text).toBe('הכנסות');
  });

  it('preserves dates as Date objects', () => {
    const summary = sheets2026[0];
    expect(summary.cells[1][0].value).toBeInstanceOf(Date);
  });

  it('yields empty string text for blank cells', () => {
    const summary = sheets2026[0];
    expect(summary.cells[0][4].text).toBe('');
  });

  it('resolves formula cells to their computed result, not the formula text', () => {
    const budget = sheets2026.find((s) => s.name === 'תקציב קאמפ ברן 26')!;
    // D3 = עלות כוללת for שירותים נסורת = 1625
    const d3 = budget.cells[2][3];
    expect(d3.text).not.toContain('=');
    expect(Number(d3.value)).toBe(1625);
  });

  it('extracts all three reference workbooks without throwing', async () => {
    const all = await Promise.all(
      [FIXTURES.y2324, FIXTURES.y25, FIXTURES.y26].map((f) =>
        extractWorkbook(fixtureBuffer(f)),
      ),
    );
    expect(all.flat().length).toBe(19);
  });
});
