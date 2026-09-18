/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { DecisionRow, SeasonOverview } from '@/lib/overview/summary';
import type { TaskCoverage } from '@/lib/work/coverage';
import type { UnpaidMember } from '@/lib/fees/summary';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` gives the factories something to close over.
 */
const { requireAdmin, resolveSeason, seasonOverview } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  resolveSeason: vi.fn(),
  seasonOverview: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/seasons/current', () => ({ resolveSeason }));
vi.mock('@/lib/overview/summary', () => ({ seasonOverview }));

import HomePage from './page';

const SEASON = {
  id: 's26', name: 'ברן 26', year: 2026, flatRate: '1200.00',
  plannedSize: 35, startsOn: null,
};
const OLDER = { ...SEASON, id: 's25', name: 'ברן 25', year: 2025, flatRate: '1500.00' };

function overview(overrides: Partial<SeasonOverview> = {}): SeasonOverview {
  return {
    seasonId: 's26',
    seasonName: 'ברן 26',
    memberCount: 35,
    flatRateAgorot: 120000,
    dues: null,
    cash: null,
    debts: null,
    coverage: null,
    understaffed: [],
    decisions: { total: 0, items: [] },
    ...overrides,
  };
}

/**
 * Typed against the library's own row rather than spelled inline, for the
 * reason `FULL` is: when the register widens what a decision carries, this
 * file stops compiling instead of quietly testing a shape nothing produces.
 */
function decision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 'name:a1',
    kind: 'unlinked-name',
    title: '״נועה ל.״',
    detail: 'שם מקובץ · הצעה: נועה לוי (strong)',
    source: 'קופת קאמפ 2026!B14',
    actionLabel: 'קישור לנועה לוי',
    href: '/inbox?item=name:a1',
    blocksImport: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  resolveSeason.mockResolvedValue({ seasons: [SEASON], current: SEASON });
  seasonOverview.mockResolvedValue(overview());
});

const SOURCE = readFileSync(
  join(process.cwd(), 'src/app/(admin)/(home)/page.tsx'), 'utf8',
);

describe('HomePage', () => {
  it('enforces the admin gate before touching the database', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    // The gate must short-circuit before any query runs, not merely omit a
    // section of an otherwise-fetched page.
    expect(resolveSeason).not.toHaveBeenCalled();
    expect(seasonOverview).not.toHaveBeenCalled();
  });

  it('invites the lead into import when the camp has no season at all', async () => {
    resolveSeason.mockResolvedValue({ seasons: [], current: null });
    render(await HomePage({ searchParams: Promise.resolve({}) }));

    // C10 owns the sentence; the screen supplies the plural noun and the way out.
    expect(screen.getByText('כאן יופיעו שנים. עדיין לא נוספו.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'מעבר לייבוא' });
    expect(link.getAttribute('href')).toBe('/upload');
    expect(seasonOverview).not.toHaveBeenCalled();
  });

  it('takes the season from the shared control, not from the newest row', async () => {
    resolveSeason.mockResolvedValue({ seasons: [SEASON, OLDER], current: OLDER });
    render(await HomePage({ searchParams: Promise.resolve({ season: 's25' }) }));

    expect(resolveSeason).toHaveBeenCalledWith({}, 's25');
    expect(seasonOverview).toHaveBeenCalledWith({}, 's25');
    // `seasons[0]` here is ברן 26. A page that still led with the newest row
    // would show that name while the URL, the sidebar and every link said 25.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ברן 25');
  });

  it('never reaches for the newest season itself', () => {
    expect(SOURCE).not.toContain('seasons[0]');
    expect(SOURCE).not.toContain('listSeasons');
  });

  it('reads the whole screen from one summary call, never a query per card', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    expect(seasonOverview).toHaveBeenCalledTimes(1);

    for (const forbidden of [
      '@/lib/fees/summary', '@/lib/money/accounts', '@/lib/money/obligations',
      '@/lib/work/coverage', '@/lib/members/identity', '@/lib/money/summary',
      '@/lib/money/overview', '@/lib/fees/dues', '@/lib/fees/season-fees',
      '@/lib/work/tasks', '@/lib/members/roster', '@/lib/inbox/',
    ]) {
      expect({ forbidden, present: SOURCE.includes(forbidden) })
        .toEqual({ forbidden, present: false });
    }
  });

  it('leads with the season, its roster size and its rate', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ברן 26');
    // A17: one isolate per phrase, so the whole sentence is queryable.
    expect(screen.getByText('35 חברים ברשימה')).toBeTruthy();
    expect(screen.getByText('1,200 ₪')).toBeTruthy();
  });

  it('says so, and points at import, when the season holds nothing yet', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    // Every empty state on this screen names the season and offers a next step
    // — the /money page had to learn that twice.
    expect(screen.getByText('אין נתונים בברן 26. בשנים אחרות ייתכן שיש.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'מעבר לייבוא' });
    expect(link.getAttribute('href')).toBe('/upload');
  });
});

/**
 * Typed against the real shape rather than inferred with `as const`, for two
 * reasons. `as const` makes `unpaid` a `readonly []`, which cannot satisfy
 * plan 07's `UnpaidMember[]`; and an annotated fixture is an oracle — when
 * plan 07 widens `seasonFeeSummary` again, or plan 10 renames a field of
 * `SeasonCoverage`, this file stops compiling instead of quietly testing a
 * shape the libraries no longer produce.
 */
const FULL: {
  dues: NonNullable<SeasonOverview['dues']>;
  cash: NonNullable<SeasonOverview['cash']>;
  debts: NonNullable<SeasonOverview['debts']>;
  coverage: NonNullable<SeasonOverview['coverage']>;
} = {
  dues: {
    expectedAgorot: 3650000, collectedAgorot: 2430000, outstandingAgorot: 1220000,
    unpaidCount: 9, partlyPaidCount: 3, missingDuesCount: 2, unpaid: [],
  },
  cash: { totalAgorot: 6091255, accountCount: 3, unattributedInAgorot: 240000 },
  debts: { campOwesAgorot: 686400, owedToCampAgorot: 235000, unnamedCount: 2 },
  coverage: {
    tasks: 12, openTasks: 10, uncoveredTasks: 6,
    placesNeeded: 32, placesFilled: 16, datelessTasks: 0, linkedBudgetAgorot: 0,
  },
};

/**
 * `/` lives in the (home) route group; every other admin route is a plain
 * folder under (admin), and a segment with no folder of its own resolves
 * through that level's `[…]` directory — `/members/p9` through `members/[id]`.
 */
function routeExists(pathname: string): boolean {
  const clean = pathname.split('?')[0].split('#')[0];
  const segments = clean.split('/').filter(Boolean);
  let dir = join(process.cwd(), 'src/app/(admin)');
  if (segments.length === 0) return existsSync(join(dir, '(home)', 'page.tsx'));
  for (const segment of segments) {
    if (existsSync(join(dir, segment))) {
      dir = join(dir, segment);
      continue;
    }
    const dynamic = readdirSync(dir)
      .find((entry) => entry.startsWith('[') && entry.endsWith(']'));
    if (dynamic === undefined) return false;
    dir = join(dir, dynamic);
  }
  return existsSync(join(dir, 'page.tsx'));
}

describe('routeExists', () => {
  /**
   * The positive control for the net below. Without it, a `routeExists` that
   * returned `true` for everything — or a walk that threw and was caught —
   * would make "no link is dangling" pass over a screen full of 404s.
   */
  it('says yes to a route that exists and no to one that does not', () => {
    expect(routeExists('/')).toBe(true);
    expect(routeExists('/fees?season=s26')).toBe(true);
    expect(routeExists('/members/p9')).toBe(true);
    // `/inbox` is asserted positively now that plan 05 has landed it: the
    // preview's every link goes there, and a net that could not tell a real
    // register from a missing one would pass over six 404s.
    expect(routeExists('/inbox?season=s26')).toBe(true);
    expect(routeExists('/nowhere-at-all')).toBe(false);
    expect(routeExists('/money/nowhere')).toBe(false);
  });
});

describe('HomePage figures', () => {
  beforeEach(() => {
    seasonOverview.mockResolvedValue(overview(FULL));
  });

  it('shows the four figures a lead can act on', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const dues = screen.getByRole('link', { name: /נגבה מדמי קאמפ/ });
    expect(within(dues).getByText('24,300 ₪')).toBeTruthy();
    expect(within(dues).getByText('מתוך 36,500 ₪')).toBeTruthy();
    expect(within(dues).getByText('9 טרם שילמו')).toBeTruthy();
    expect(within(dues).getByText('3 שילמו חלקית')).toBeTruthy();

    const cash = screen.getByRole('link', { name: /כסף בקופות/ });
    expect(within(cash).getByText('60,912.55 ₪')).toBeTruthy();
    expect(within(cash).getByText('ב־3 חשבונות')).toBeTruthy();

    const debts = screen.getByRole('link', { name: /חובות פתוחים/ });
    expect(within(debts).getByText('6,864 ₪')).toBeTruthy();
    expect(within(debts).getByText('חייבים לנו 2,350 ₪')).toBeTruthy();

    const tasks = screen.getByRole('link', { name: /איוש משימות/ });
    expect(within(tasks).getByText('16 מתוך 32 מקומות')).toBeTruthy();
    expect(within(tasks).getByText('6 משימות עדיין חסרות אנשים')).toBeTruthy();
  });

  it('links every figure to the page that can change it', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    expect(screen.getByRole('link', { name: /נגבה מדמי קאמפ/ }).getAttribute('href'))
      .toBe('/fees?season=s26');
    expect(screen.getByRole('link', { name: /כסף בקופות/ }).getAttribute('href'))
      .toBe('/money?season=s26');
    // D8's /money/debts exists now, but the two obligation tables this figure
    // sums still live on /money itself; retarget when D8 owns both directions.
    expect(screen.getByRole('link', { name: /חובות פתוחים/ }).getAttribute('href'))
      .toBe('/money?season=s26');
    expect(screen.getByRole('link', { name: /איוש משימות/ }).getAttribute('href'))
      .toBe('/tasks?season=s26');
  });

  it('never sends a lead to a route that does not exist', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(4);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect({ href, exists: routeExists(href) }).toEqual({ href, exists: true });
    }
  });

  it('carries the unplaced money and the nameless debts as warnings, in words', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    // R3: a state never reads as colour alone. Both of these carry a sentence.
    expect(screen.getByText('2,400 ₪ נרשמו בלי חשבון')).toBeTruthy();
    expect(screen.getByText('2 חובות בלי שם')).toBeTruthy();
  });

  it('says nothing about unplaced money when every shekel is placed', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      cash: { totalAgorot: 6091255, accountCount: 3, unattributedInAgorot: 0 },
      debts: { campOwesAgorot: 686400, owedToCampAgorot: 235000, unnamedCount: 0 },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    // A `>= 0` off-by-one would put both warnings on every season forever.
    expect(screen.queryByText(/נרשמו בלי חשבון/)).toBeNull();
    expect(screen.queryByText(/חובות בלי שם/)).toBeNull();
  });

  it('draws only the figures that have something to report', async () => {
    seasonOverview.mockResolvedValue(overview({
      dues: FULL.dues, cash: null, debts: null, coverage: null,
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    expect(screen.getByRole('link', { name: /נגבה מדמי קאמפ/ })).toBeTruthy();
    // Not "0 ₪ across 0 accounts", not "0 of 0 places" — absent. A card that
    // always reads zero teaches its reader to skip the row that will one day
    // matter.
    expect(screen.queryByText('כסף בקופות')).toBeNull();
    expect(screen.queryByText('חובות פתוחים')).toBeNull();
    expect(screen.queryByText('איוש משימות')).toBeNull();
    // One figure is still a screen with content, so the season-wide empty
    // state must not appear alongside it.
    expect(screen.queryByText('אין נתונים בברן 26. בשנים אחרות ייתכן שיש.')).toBeNull();
  });

  it('never claims more than a full bar when a season is overpaid', async () => {
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    // 24,300 of 36,500 is 67%. The bar's accessible name is the only place the
    // percentage is stated in words, so it is what a wrong one would show.
    expect(screen.getByRole('img', { name: 'נגבו 67 אחוזים מצפי הגבייה' })).toBeTruthy();

    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      dues: { ...FULL.dues, collectedAgorot: 4000000, outstandingAgorot: 0 },
    }));
    const overpaid = render(await HomePage({
      searchParams: Promise.resolve({ season: 's26' }),
    }));
    // 4,000,000 of 3,650,000 is 110%. Unclamped the tile would announce
    // "נגבו 110 אחוזים" beside a bar that physically cannot draw it.
    expect(within(overpaid.container)
      .getByRole('img', { name: 'נגבו 100 אחוזים מצפי הגבייה' })).toBeTruthy();
  });
});

describe('HomePage — the לטיפול preview', () => {
  function inboxPanel(): HTMLElement {
    return screen.getByRole('heading', { name: 'לטיפול' })
      .closest('section') as HTMLElement;
  }

  const WAITING: DecisionRow[] = [
    decision(),
    decision({
      id: 'sheet-season:s1',
      kind: 'sheet-season',
      title: 'לגיליון ״סיכום כללי״ אין שנה',
      detail: 'לגיליון לא נקבעה עונה, ותקציב חייב עונה',
      source: null,
      actionLabel: 'בחירת עונה',
      href: '/inbox?item=sheet-season:s1',
      blocksImport: true,
    }),
  ];

  it('celebrates only when it knows there is nothing to decide', async () => {
    seasonOverview.mockResolvedValue(overview({ ...FULL }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = inboxPanel();
    // C10 owns all-clear's words; the panel supplies the scope they apply to.
    expect(within(panel).getByText('הכול מטופל')).toBeTruthy();
    expect(within(panel).getByText('ברן 26')).toBeTruthy();
  });

  it('shows what is waiting, with its evidence and the register\'s own verb', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: { total: 2, items: WAITING },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = inboxPanel();
    expect(within(panel).queryByText('הכול מטופל')).toBeNull();
    expect(within(panel).getByText('״נועה ל.״')).toBeTruthy();
    expect(within(panel).getByText('לגיליון ״סיכום כללי״ אין שנה')).toBeTruthy();
    // R11: the figure keeps the workbook cell it came from, in mono.
    expect(within(panel).getByText('קופת קאמפ 2026!B14')).toBeTruthy();
    expect(within(panel).getByText('2 החלטות')).toBeTruthy();
  });

  it('marks the decision promotion is actually waiting on, and only that one', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: { total: 2, items: WAITING },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const rows = within(inboxPanel()).getAllByRole('listitem');
    // A name is open and does not hold the importer up; a season-less sheet
    // does. A pill on every row says nothing, and this one has to mean it.
    expect(within(rows[0]).queryByText('חוסם ייבוא')).toBeNull();
    expect(within(rows[1]).getByText('חוסם ייבוא')).toBeTruthy();
  });

  it('sends every row to the register, and settles nothing itself', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: { total: 2, items: WAITING },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = inboxPanel();
    const action = within(panel).getByRole('link', { name: 'קישור לנועה לוי' });
    expect(action.getAttribute('href')).toBe('/inbox?item=name:a1');
    expect(within(panel).getByRole('link', { name: 'בחירת עונה' }).getAttribute('href'))
      .toBe('/inbox?item=sheet-season:s1');
    // A23: the home offers no control that writes — not a promotion, not a
    // link, not a name. Every verb here is a way into the register.
    expect(within(panel).queryByRole('button')).toBeNull();
    for (const link of within(panel).getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect({ href, register: href.startsWith('/inbox') })
        .toEqual({ href, register: true });
    }
  });

  it('opens the register on the season the screen is showing', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: { total: 2, items: WAITING },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    expect(within(inboxPanel()).getByRole('link', { name: /לכל הרשימה/ })
      .getAttribute('href')).toBe('/inbox?season=s26');
  });

  it('says what did not fit, rather than quietly dropping it', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: {
        total: 12,
        items: [0, 1, 2, 3, 4, 5].map((i) => decision({
          id: `name:a${i}`, title: `שם ${i}`, href: `/inbox?item=name:a${i}`,
        })),
      },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = inboxPanel();
    expect(within(panel).getAllByRole('listitem')).toHaveLength(6);
    // Twelve are open and six are shown. The other six are stated, not cut.
    expect(within(panel).getByText('ועוד 6 החלטות ברשימה')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'פתיחת הרשימה' })
      .getAttribute('href')).toBe('/inbox?season=s26');
  });

  it('states the panel is the screen\'s own, not a guess', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: { total: 2, items: WAITING },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    expect(screen.getByText('המערכת לא מנחשת. אלה ההכרעות שממתינות.')).toBeTruthy();
  });

  it('says one decision rather than one decisions', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      decisions: { total: 1, items: [decision()] },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    expect(within(inboxPanel()).getByText('החלטה אחת')).toBeTruthy();
  });
});

function task(overrides: Partial<TaskCoverage> = {}): TaskCoverage {
  return {
    taskId: 't1', title: 'הקמת הצל והמבנה', kind: 'build', status: 'open',
    peopleNeeded: 8, accepted: 5, uncovered: true, eventName: null,
    budgetAgorot: null, startsAt: null, endsAt: null, dueOn: null,
    assignees: [
      { assignmentId: 'a1', personId: 'p1', displayName: 'רן אבידן', status: 'accepted' },
      { assignmentId: 'a2', personId: 'p2', displayName: 'יעל לוי', status: 'accepted' },
    ],
    eventHeldOn: null,
    budgetLineId: null, budgetLineLabel: null, budgetLineTotalAgorot: null,
    ...overrides,
  };
}

function unpaidRow(overrides: Partial<UnpaidMember> = {}): UnpaidMember {
  return {
    personId: 'p9', displayName: 'איתי כהן', dueId: 'd9', kind: 'flat',
    amountAgorot: 120000, paidAgorot: 0, outstandingAgorot: 120000,
    ...overrides,
  };
}

describe('HomePage — the two side panels', () => {
  function panelFor(heading: string): HTMLElement {
    return screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;
  }

  it('lists the tasks still short of people, with their coverage', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      understaffed: [
        task({ taskId: 't1', title: 'פירוק ו־MOOP', peopleNeeded: 6, accepted: 0, assignees: [] }),
        task({ taskId: 't2', title: 'הקמת הצל והמבנה', peopleNeeded: 8, accepted: 5 }),
        task({
          taskId: 't3', title: 'מסיבת גיוס — דלת', kind: 'event_task',
          peopleNeeded: 2, accepted: 0, eventName: 'מסיבת אוקטובר', assignees: [],
        }),
      ],
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = panelFor('חסרים אנשים');
    const rows = within(panel).getAllByRole('listitem');
    expect(within(rows[0]).getByText('פירוק ו־MOOP')).toBeTruthy();
    expect(within(rows[0]).getByText('0/6')).toBeTruthy();
    expect(within(rows[1]).getByText('5/8')).toBeTruthy();
    // The kind reads in words, and an event task names its event.
    expect(rows[0].textContent).toContain('הקמה ולוגיסטיקה');
    expect(rows[2].textContent).toContain('משימה באירוע');
    expect(rows[2].textContent).toContain('מסיבת אוקטובר');

    const link = within(panel).getByRole('link', { name: /לכל המשימות/ });
    expect(link.getAttribute('href')).toBe('/tasks?season=s26');
  });

  it('says what did not fit rather than quietly dropping it', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      understaffed: [0, 1, 2, 3, 4, 5].map((i) => task({ taskId: `t${i}`, title: `משימה ${i}` })),
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    // Six tasks are short; the panel shows four. The other two are stated, not
    // silently cut — FULL.coverage.uncoveredTasks is the honest total.
    expect(within(panelFor('חסרים אנשים')).getAllByRole('listitem')).toHaveLength(4);
    expect(within(panelFor('חסרים אנשים')).getByText('ועוד 2 משימות חסרות אנשים')).toBeTruthy();
  });

  it('celebrates a fully staffed season rather than showing an empty list', async () => {
    seasonOverview.mockResolvedValue(overview({ ...FULL, understaffed: [] }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = panelFor('חסרים אנשים');
    expect(within(panel).getByText('הכול מטופל')).toBeTruthy();
    expect(within(panel).getByText('ברן 26')).toBeTruthy();
  });

  it('drops the staffing panel entirely for a season with no open task', async () => {
    seasonOverview.mockResolvedValue(overview({ ...FULL, coverage: null, understaffed: [] }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    // Nobody has made a task yet, so "הכול מטופל" would congratulate the camp
    // for work it has not started — the same lie the unpaid panel refuses.
    expect(screen.queryByRole('heading', { name: 'חסרים אנשים' })).toBeNull();
  });

  it('names who has not paid, what they owe, and where to record it', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      dues: {
        ...FULL.dues,
        missingDuesCount: 2,
        unpaid: [
          unpaidRow(),
          unpaidRow({
            personId: 'p8', displayName: 'גיל ברק', dueId: 'd8', kind: 'exception',
            amountAgorot: 90000, outstandingAgorot: 90000,
          }),
          unpaidRow({
            personId: 'p7', displayName: 'הילה נחום', dueId: 'd7',
            amountAgorot: 120000, paidAgorot: 50000, outstandingAgorot: 70000,
          }),
        ],
      },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = panelFor('טרם שילמו');
    const rows = within(panel).getAllByRole('listitem');

    const itay = within(rows[0]).getByRole('link', { name: 'איתי כהן' });
    expect(itay.getAttribute('href')).toBe('/members/p9');
    expect(rows[0].textContent).toContain('תעריף רגיל');
    expect(rows[0].textContent).toContain('1,200');

    expect(within(rows[1]).getByText('חריג')).toBeTruthy();
    expect(rows[1].textContent).toContain('900');

    // A part payment says what arrived, in the passive — the database knows no
    // gender, and "שילמה" would be a guess.
    expect(within(rows[2]).getByText('שולם 500 ₪')).toBeTruthy();
    expect(rows[2].textContent).toContain('700');
    expect(rows[2].textContent).not.toContain('שילמה');
    expect(rows[2].textContent).not.toContain('שילם ');

    // I9: the fees drawer is `?peek=<personId>&act=pay`, built by the kit's
    // helper rather than spelled here, so it opens a drawer that exists.
    const record = within(rows[0]).getByRole('link', { name: 'רישום תשלום לאיתי כהן' });
    expect(record.getAttribute('href')).toBe('/fees?season=s26&peek=p9&act=pay');
  });

  it('reports the charges nobody has issued, and links to where billing happens', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      dues: { ...FULL.dues, missingDuesCount: 2, unpaid: [unpaidRow()] },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    const panel = panelFor('טרם שילמו');
    // Said about the charge, not about the people — the database records no
    // gender, and /fees already states it this way.
    expect(within(panel).getByText('2 חיובים עדיין לא הונפקו')).toBeTruthy();
    // This screen writes nothing: issuing a due is D5's action, behind a link.
    expect(within(panel).queryByRole('button')).toBeNull();
  });

  it('celebrates when everybody who was billed has paid', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      dues: { ...FULL.dues, unpaidCount: 0, partlyPaidCount: 0, missingDuesCount: 0, unpaid: [] },
    }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));

    expect(within(panelFor('טרם שילמו')).getByText('הכול מטופל')).toBeTruthy();
  });

  it('drops the unpaid panel entirely when no due has been issued', async () => {
    seasonOverview.mockResolvedValue(overview({ ...FULL, dues: null }));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    // Nothing has been billed, so "הכול מטופל" would be a congratulation for
    // work nobody has started.
    expect(screen.queryByRole('heading', { name: 'טרם שילמו' })).toBeNull();
  });
});

describe('HomePage — reachability', () => {
  it('labels every icon-only control with the person or page it acts on', async () => {
    seasonOverview.mockResolvedValue(overview({
      ...FULL,
      dues: { ...FULL.dues, unpaid: [unpaidRow()] },
      understaffed: [task()],
      decisions: { total: 1, items: [decision()] },
    }));
    const { container } = render(await HomePage({
      searchParams: Promise.resolve({ season: 's26' }),
    }));

    const controls = container.querySelectorAll('a, button');
    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) {
      const text = (control.textContent ?? '').trim();
      const label = control.getAttribute('aria-label') ?? '';
      // Either the control says what it does, or it says so to a screen reader.
      expect({ html: control.outerHTML, named: text.length > 0 || label.length > 0 })
        .toEqual({ html: control.outerHTML, named: true });
    }
  });

  it('gives every panel a heading a reader can navigate by', async () => {
    seasonOverview.mockResolvedValue(overview(FULL));
    render(await HomePage({ searchParams: Promise.resolve({ season: 's26' }) }));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['לטיפול', 'חסרים אנשים', 'טרם שילמו']);
  });
});
