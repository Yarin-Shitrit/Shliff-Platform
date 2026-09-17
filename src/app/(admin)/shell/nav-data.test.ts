import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, activeItemId } from '@/app/(admin)/shell/nav-data';

describe('nav data', () => {
  it('holds B1 sections in B1 order, grouped as B1 groups them', () => {
    expect(NAV_GROUPS.map((group) => group.label))
      .toEqual([null, 'הקאמפ', 'כספים', 'נתונים']);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'בית', 'לטיפול',
      'אנשים', 'דמי קאמפ', 'משימות',
      'סקירה כספית', 'תנועות', 'תקציב', 'חובות',
      'קבצים וייבוא', 'העלאת קובץ',
    ]);
  });

  it('carries a count only where a count is actionable (B2)', () => {
    const counted = NAV_ITEMS.filter((item) => item.count);
    expect(counted.map((item) => [item.label, item.count])).toEqual([
      ['לטיפול', 'openDecisions'],
      ['אנשים', 'rosterSize'],
      ['משימות', 'understaffedTasks'],
    ]);
  });

  it('marks the section a record page belongs to (B3)', () => {
    expect(activeItemId('/members/6f1c0e0e-0000-4000-8000-000000000000')).toBe('people');
    expect(activeItemId('/imports/6f1c0e0e-0000-4000-8000-000000000000')).toBe('files');
  });

  it('gives the longest matching section the mark, not the first', () => {
    expect(activeItemId('/money')).toBe('money');
    expect(activeItemId('/money/ledger')).toBe('ledger');
    expect(activeItemId('/money/debts')).toBe('debts');
  });

  it('matches home exactly, so every path does not light it up', () => {
    expect(activeItemId('/')).toBe('home');
    expect(activeItemId('/fees')).toBe('dues');
  });

  it('marks nothing for a path no section owns', () => {
    expect(activeItemId('/signin')).toBeNull();
  });

  it('never matches a partial segment', () => {
    expect(activeItemId('/membership')).toBeNull();
  });

  it('points every live item at a destination and never at a bare hash', () => {
    for (const item of NAV_ITEMS) {
      expect(item.href.startsWith('/')).toBe(true);
    }
  });
});
