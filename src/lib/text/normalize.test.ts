import { describe, it, expect } from 'vitest';
import { normalizeHebrew } from '@/lib/text/normalize';

describe('normalizeHebrew', () => {
  it('unifies gershayim variants', () => {
    expect(normalizeHebrew('סה״כ')).toBe(normalizeHebrew('סה"כ'));
    expect(normalizeHebrew('עו״ש')).toBe(normalizeHebrew('עו"ש'));
  });

  it('unifies geresh and apostrophe variants', () => {
    expect(normalizeHebrew('ברן 25׳')).toBe(normalizeHebrew("ברן 25'"));
    // U+2019 on the left, U+0027 on the right
    expect(normalizeHebrew('קופת קאמפ 25' + '’')).toBe(normalizeHebrew("קופת קאמפ 25'"));
  });

  it('unifies left single quotation mark with apostrophe', () => {
    // U+2018 (left single quotation mark) should normalize to ASCII apostrophe
    const leftQuote = '‘';
    expect(normalizeHebrew('test' + leftQuote)).toBe(normalizeHebrew("test'"));
  });

  it('removes directional and zero-width marks', () => {
    // LRM (U+200E), RLM (U+200F), ZWS (U+200B), ZWJ (U+200D)
    const base = 'סה״כ';
    const lrm = '‎';
    const rlm = '‏';
    const zws = '​';
    const zwj = '‍';
    expect(normalizeHebrew(base + lrm)).toBe(normalizeHebrew(base));
    expect(normalizeHebrew(base + rlm)).toBe(normalizeHebrew(base));
    expect(normalizeHebrew(base + zws)).toBe(normalizeHebrew(base));
    expect(normalizeHebrew(base + zwj)).toBe(normalizeHebrew(base));
  });

  it('collapses whitespace and non-breaking spaces', () => {
    expect(normalizeHebrew('  סוג   הוצאה  ')).toBe('סוג הוצאה');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHebrew('')).toBe('');
    expect(normalizeHebrew('   ')).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(normalizeHebrew('SuperNature 18.7')).toBe('SuperNature 18.7');
  });
});
