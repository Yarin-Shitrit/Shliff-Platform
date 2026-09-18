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

  /**
   * The old version asserted `item.href.startsWith('/')` over the very
   * `NAV_ITEMS` constant this file imports — a check that a literal object
   * satisfies a property of itself, so it stays green however an href is
   * reworded (a swap to the wrong route still starts with `/`).
   *
   * This pins the full id→href map instead. It also restores an assertion
   * that was genuinely lost when the old nav was deleted: the old
   * `nav.test.tsx` asserted משימות → `/tasks`, and nothing currently in the
   * suite covers that href — it is included here.
   */
  it('points every item at its real destination, and never at a bare hash', () => {
    const hrefById = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.href]));
    expect(hrefById).toEqual({
      home: '/',
      inbox: '/inbox',
      people: '/members',
      dues: '/fees',
      tasks: '/tasks',
      money: '/money',
      ledger: '/money/ledger',
      budget: '/money#budget',
      debts: '/money/debts',
      files: '/imports',
      upload: '/upload',
    });
  });
});
