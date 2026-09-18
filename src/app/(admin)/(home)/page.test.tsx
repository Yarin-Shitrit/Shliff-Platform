/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { SeasonOverview } from '@/lib/overview/summary';

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
    unlinkedCount: 0,
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
    // Deliberately not `/inbox`: plan 05 is building that route right now, so
    // a control keyed on its absence would start failing the hour it lands.
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
