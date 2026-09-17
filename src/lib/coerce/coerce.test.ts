import { describe, it, expect, beforeAll } from 'vitest';
import { parseNumber, detectSignConvention } from '@/lib/coerce/number';
import { parseQuantity } from '@/lib/coerce/quantity';
import { parseDate } from '@/lib/coerce/date';
import { extractWorkbook } from '@/lib/xlsx/extract';
import type { SheetGrid } from '@/lib/xlsx/types';
import { FIXTURES, fixtureBuffer } from '@/test/fixtures';

describe('parseNumber', () => {
  it('passes through real numbers', () => {
    expect(parseNumber(1625)).toBe(1625);
    expect(parseNumber(-1170)).toBe(-1170);
    expect(parseNumber(231.875)).toBe(231.875);
  });

  it('strips thousands separators', () => {
    expect(parseNumber('12,000')).toBe(12000);
    expect(parseNumber('1,234.5')).toBe(1234.5);
  });

  it('strips the shekel sign and surrounding whitespace', () => {
    expect(parseNumber(' ₪500 ')).toBe(500);
  });

  it('returns null for placeholders and non-numeric text', () => {
    expect(parseNumber('?')).toBeNull();
    expect(parseNumber('??')).toBeNull();
    expect(parseNumber('מכולה')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  it('never coerces a placeholder to zero', () => {
    expect(parseNumber('?')).not.toBe(0);
  });
});

describe('detectSignConvention', () => {
  it('detects the 23-24 ledger convention where outflows are negative', () => {
    expect(detectSignConvention([-1170, -488, -153, -1170])).toBe('negative-is-outflow');
  });

  it('detects the 2026 ledger convention where outflows are positive', () => {
    expect(detectSignConvention([14000, 7350, 3000, 8820])).toBe('positive');
  });

  it('ignores nulls and zeroes when deciding', () => {
    expect(detectSignConvention([null, 0, -1170, -488])).toBe('negative-is-outflow');
  });

  it('defaults to positive for mixed or empty input', () => {
    expect(detectSignConvention([])).toBe('positive');
    expect(detectSignConvention([-100, 200])).toBe('positive');
  });
});

describe('parseQuantity', () => {
  it('extracts a number and unit from text like 12,000kw', () => {
    expect(parseQuantity('12,000kw')).toEqual({
      value: 12000, unit: 'kw', text: '12,000kw', isUnknown: false,
    });
    expect(parseQuantity('9,000kw')).toEqual({
      value: 9000, unit: 'kw', text: '9,000kw', isUnknown: false,
    });
    expect(parseQuantity('21kwh')).toEqual({
      value: 21, unit: 'kwh', text: '21kwh', isUnknown: false,
    });
  });

  it('preserves descriptive quantities with no numeric part', () => {
    expect(parseQuantity('מכולה')).toEqual({
      value: null, unit: null, text: 'מכולה', isUnknown: false,
    });
    expect(parseQuantity('תפריט שלם לשבוע')).toEqual({
      value: null, unit: null, text: 'תפריט שלם לשבוע', isUnknown: false,
    });
    expect(parseQuantity('משאית הלוך חזור')).toEqual({
      value: null, unit: null, text: 'משאית הלוך חזור', isUnknown: false,
    });
  });

  it('flags placeholders as unknown rather than zero', () => {
    const q = parseQuantity('?');
    expect(q.isUnknown).toBe(true);
    expect(q.value).toBeNull();
  });

  it('handles plain numbers', () => {
    expect(parseQuantity(38)).toEqual({
      value: 38, unit: null, text: '38', isUnknown: false,
    });
  });

  it('always preserves the original text', () => {
    expect(parseQuantity('10% תקציב').text).toBe('10% תקציב');
  });
});

describe('parseDate', () => {
  it('passes through real dates', () => {
    const d = new Date(Date.UTC(2025, 4, 20));
    const parsed = parseDate(d);
    expect(parsed.ok).toBe(true);
    expect(parsed.date).toEqual(d);
  });

  it('flags the malformed 01/052024 value rather than guessing', () => {
    const parsed = parseDate('01/052024');
    expect(parsed.ok).toBe(false);
    expect(parsed.date).toBeNull();
    expect(parsed.raw).toBe('01/052024');
  });

  it('flags empty values as not-ok', () => {
    expect(parseDate('').ok).toBe(false);
    expect(parseDate(null).ok).toBe(false);
  });

  it('parses unambiguous ISO dates', () => {
    const parsed = parseDate('2025-10-30');
    expect(parsed.ok).toBe(true);
    expect(parsed.date?.getUTCFullYear()).toBe(2025);
  });

  it('rejects calendar-invalid dates instead of rolling them into the next month', () => {
    const day31Feb = parseDate('31/02/2024');
    expect(day31Feb.ok).toBe(false);
    expect(day31Feb.date).toBeNull();
    expect(day31Feb.raw).toBe('31/02/2024');

    const month13 = parseDate('13/13/2024');
    expect(month13.ok).toBe(false);
    expect(month13.date).toBeNull();

    const day32 = parseDate('32/01/2024');
    expect(day32.ok).toBe(false);
    expect(day32.date).toBeNull();

    const isoFeb30 = parseDate('2025-02-30');
    expect(isoFeb30.ok).toBe(false);
    expect(isoFeb30.date).toBeNull();
  });

  it('still parses a valid leap-day date', () => {
    const parsed = parseDate('29/02/2024');
    expect(parsed.ok).toBe(true);
    expect(parsed.date?.getUTCFullYear()).toBe(2024);
    expect(parsed.date?.getUTCMonth()).toBe(1);
    expect(parsed.date?.getUTCDate()).toBe(29);
  });

  // Task 12b: raw_grid renders an Excel date cell with toISOString(), so the
  // real stored text is a full ISO-8601 timestamp, never a bare YYYY-MM-DD.
  it('parses an ISO timestamp (midnight) to its UTC calendar date', () => {
    const parsed = parseDate('2025-05-20T00:00:00.000Z');
    expect(parsed.ok).toBe(true);
    expect(parsed.date?.getUTCFullYear()).toBe(2025);
    expect(parsed.date?.getUTCMonth()).toBe(4);
    expect(parsed.date?.getUTCDate()).toBe(20);
  });

  it('discards the time of day rather than rolling the calendar date', () => {
    const parsed = parseDate('2025-05-20T21:30:00.000Z');
    expect(parsed.ok).toBe(true);
    expect(parsed.date?.getUTCFullYear()).toBe(2025);
    expect(parsed.date?.getUTCMonth()).toBe(4);
    expect(parsed.date?.getUTCDate()).toBe(20);
  });

  it('accepts an ISO timestamp with no seconds and no milliseconds', () => {
    const noSeconds = parseDate('2025-05-20T00:00');
    expect(noSeconds.ok).toBe(true);
    expect(noSeconds.date?.getUTCDate()).toBe(20);

    const withSeconds = parseDate('2025-05-20T00:00:00');
    expect(withSeconds.ok).toBe(true);
    expect(withSeconds.date?.getUTCDate()).toBe(20);
  });

  it('rejects a calendar-invalid ISO timestamp', () => {
    const parsed = parseDate('2025-02-30T00:00:00.000Z');
    expect(parsed.ok).toBe(false);
    expect(parsed.date).toBeNull();
  });

  it('rejects a non-Z numeric offset, preserving the raw text', () => {
    const parsed = parseDate('2025-05-20T23:00:00+03:00');
    expect(parsed.ok).toBe(false);
    expect(parsed.date).toBeNull();
    expect(parsed.raw).toBe('2025-05-20T23:00:00+03:00');
  });

  // The regression this task exists for: no hand-written date string, the
  // date cell's text comes out of a real workbook through extractWorkbook,
  // exactly as the import pipeline reads it.
  describe('against a real workbook cell', () => {
    let sheets: SheetGrid[];

    beforeAll(async () => {
      sheets = await extractWorkbook(fixtureBuffer(FIXTURES.y26));
    });

    it('accepts the ISO timestamp stored in a real ledger date cell', () => {
      const ledger = sheets.find((s) => s.name === 'סיכום כללי')!;
      const dateCell = ledger.cells[1][0];
      expect(dateCell.value).toBeInstanceOf(Date);

      const parsed = parseDate(dateCell.text);
      expect(parsed.ok).toBe(true);
    });
  });
});
