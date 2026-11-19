import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NAV_GROUPS, NAV_ITEMS, activeItemId, pageOfHref, pageOfItem } from '@/app/(admin)/shell/nav-data';
import { PAGES } from '@/lib/auth/pages';

describe('nav data', () => {
  it('holds B1 sections in B1 order, grouped as B1 groups them', () => {
    expect(NAV_GROUPS.map((group) => group.label))
      .toEqual([null, 'הקאמפ', 'כספים', 'לוגיסטיקה', 'נתונים', 'ניהול']);
    expect(NAV_ITEMS.filter((item) => !item.offRail).map((item) => item.label)).toEqual([
      'בית', 'לטיפול',
      'אנשים', 'דמי קאמפ', 'משימות', 'משמרות', 'נוכחות', 'מפת הקאמפ',
      'סקירה כספית', 'תנועות', 'הוצאות', 'מסיבות', 'תקציב', 'חובות',
      'מחסן', 'רכש', 'לוח עבודה', 'ימי עבודה',
      'קבצים וייבוא', 'העלאת קובץ',
      'משתמשים והרשאות',
    ]);
  });

  it('keeps הקמה off the rail while its route still answers', () => {
    // ימי עבודה took its place. The route stays until מפת הקאמפ stops
    // linking to it, so the path must still resolve to its own grant.
    expect(NAV_ITEMS.filter((item) => item.offRail).map((item) => item.id)).toEqual(['build']);
    expect(pageOfHref('/logistics/build?season=s26')).toBe('build');
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

  it('marks the logistics screen a lead is actually on', () => {
    // All six live under `/logistics/` (משמרות and נוכחות keep the prefix
    // though they sit under הקאמפ in the rail), so prefix matching has to
    // pick the longest — otherwise one of them would light up the rail for
    // all six.
    expect(activeItemId('/logistics/warehouse')).toBe('warehouse');
    expect(activeItemId('/logistics/acquisitions')).toBe('acquisitions');
    expect(activeItemId('/logistics/build')).toBe('build');
    expect(activeItemId('/logistics/shifts')).toBe('shifts');
    expect(activeItemId('/logistics/attendance')).toBe('attendance');
    expect(activeItemId('/logistics/plan')).toBe('plan');
    // ימי עבודה sits under the plan's route and takes the mark from it.
    expect(activeItemId('/logistics/plan/workdays')).toBe('workdays');
  });

  it('leaves the rail unmarked on the redirect that owns no screen', () => {
    // `/logistics` is a redirect to the warehouse and has no rail entry of
    // its own; a reader passes through it and never sits there.
    expect(activeItemId('/logistics')).toBeNull();
  });

  it('gives the longest matching section the mark, not the first', () => {
    expect(activeItemId('/money')).toBe('money');
    expect(activeItemId('/money/ledger')).toBe('ledger');
    expect(activeItemId('/money/expenses')).toBe('expenses');
    // A receipt is a picture under the expenses page, and opens with its grant.
    expect(activeItemId('/money/expenses/receipt/6f1c0e0e-0000-4000-8000-000000000000')).toBe('expenses');
    expect(activeItemId('/money/debts')).toBe('debts');
    expect(activeItemId('/money/events/6f1c0e0e-0000-4000-8000-000000000000')).toBe('events');
  });

  it('matches home exactly, so every path does not light it up', () => {
    expect(activeItemId('/')).toBe('home');
    expect(activeItemId('/fees')).toBe('dues');
    expect(activeItemId('/site')).toBe('site');
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
      site: '/site',
      money: '/money',
      ledger: '/money/ledger',
      expenses: '/money/expenses',
      events: '/money/events',
      budget: '/money#budget',
      debts: '/money/debts',
      warehouse: '/logistics/warehouse',
      acquisitions: '/logistics/acquisitions',
      build: '/logistics/build',
      shifts: '/logistics/shifts',
      attendance: '/logistics/attendance',
      plan: '/logistics/plan',
      workdays: '/logistics/plan/workdays',
      files: '/imports',
      upload: '/upload',
      users: '/users',
    });
  });

  /**
   * The rail rendered "בקרוב" beside לטיפול, תנועות, חובות and קבצים וייבוא
   * for the whole of waves 3 and 4, because each screen plan built its route
   * and left the flag on. The old test asserted only that *some* item read
   * בקרוב, which stayed green the entire time the label was a lie.
   *
   * This asserts the correctness instead: an item is `planned` exactly when
   * its route has no `page.tsx`. It reads the filesystem rather than a second
   * hand-kept list, so the next route to ship clears its own flag or goes red.
   */
  it('promises בקרוב only for a route that really has not shipped', () => {
    const admin = resolve(process.cwd(), 'src/app/(admin)');
    const wrong: string[] = [];

    for (const item of NAV_ITEMS) {
      const path = item.href.split('#')[0];
      // `/` is the (home) route group, which is a directory name the URL
      // does not contain; every other item maps onto its own path.
      const dir = path === '/' ? join(admin, '(home)') : join(admin, path);
      const exists = existsSync(join(dir, 'page.tsx'));
      const planned = item.planned === true;
      if (exists && planned) wrong.push(`${item.id}: ${path} has shipped but still reads בקרוב`);
      if (!exists && !planned) wrong.push(`${item.id}: ${path} has no page.tsx and is offered as a link`);
    }

    expect(wrong).toEqual([]);
  });
});

/**
 * The grant that opens an item is the item's own id, so the registry in
 * `src/lib/auth/pages.ts` and the rail must name the same pages: a rail item
 * no grant can name is a link nobody but an admin can ever use, and a grant
 * for a page the rail does not show is a decision with no visible effect.
 */
describe('the rail and the access registry name the same pages', () => {
  it('maps every item to a page, except the one page that hands out the grants', () => {
    const unmapped = NAV_ITEMS.filter((item) => pageOfItem(item) === null).map((item) => item.id);
    expect(unmapped).toEqual(['users']);
  });

  it('opens תקציב with the money page it is an anchor into', () => {
    expect(pageOfItem(NAV_ITEMS.find((item) => item.id === 'budget')!)).toBe('money');
  });

  it('opens ימי עבודה with the plan it is a screen of', () => {
    expect(pageOfItem(NAV_ITEMS.find((item) => item.id === 'workdays')!)).toBe('plan');
    expect(pageOfHref('/logistics/plan/workdays?day=d1')).toBe('plan');
  });

  it('has a rail item for every page in the registry, at the registry\'s own path and word', () => {
    for (const page of PAGES) {
      const item = NAV_ITEMS.find((candidate) => candidate.id === page.key);
      expect(item, page.key).toBeDefined();
      expect(item!.href.split('#')[0]).toBe(page.href);
      expect(item!.label).toBe(page.label);
    }
  });

  it('finds the page a link needs by the same prefix match that marks the rail', () => {
    expect(pageOfHref('/members/6f1c0e0e-0000-4000-8000-000000000000')).toBe('people');
    expect(pageOfHref('/money/ledger?season=b26#row-1')).toBe('ledger');
    expect(pageOfHref('/money#budget')).toBe('money');
    expect(pageOfHref('/')).toBe('home');
  });

  it('answers closed for a path no item owns, and for the admin-only page', () => {
    expect(pageOfHref('/nowhere')).toBeNull();
    expect(pageOfHref('/users')).toBeNull();
  });
});
