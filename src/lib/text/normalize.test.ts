import { describe, it, expect } from 'vitest';
import { normalizeHebrew } from '@/lib/text/normalize';

describe('normalizeHebrew', () => {
  it('unifies gershayim variants', () => {
    expect(normalizeHebrew('סה״כ')).toBe(normalizeHebrew('סה"כ'));
    expect(normalizeHebrew('עו״ש')).toBe(normalizeHebrew('עו"ש'));
  });

  it('unifies geresh and apostrophe variants', () => {
    expect(normalizeHebrew('ברן 25׳')).toBe(normalizeHebrew("ברן 25'"));
    expect(normalizeHebrew('קופת קאמפ 25’')).toBe(normalizeHebrew("קופת קאמפ 25'"));
  });

  it('collapses whitespace and non-breaking spaces', () => {
    expect(normalizeHebrew('  סוג   הוצאה  ')).toBe('סוג הוצאה');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHebrew('')).toBe('');
    expect(normalizeHebrew('   ')).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(normalizeHebrew('SuperNature 18.7')).toBe('SuperNature 18.7');
  });
});