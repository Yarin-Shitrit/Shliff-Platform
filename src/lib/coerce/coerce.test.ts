import { describe, it, expect } from 'vitest';
import { parseNumber, detectSignConvention } from '@/lib/coerce/number';
import { parseQuantity } from '@/lib/coerce/quantity';
import { parseDate } from '@/lib/coerce/date';

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
});
