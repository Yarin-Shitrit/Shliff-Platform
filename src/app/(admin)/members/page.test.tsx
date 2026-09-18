/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PersonListRow, PersonDues } from '@/lib/members/people-list';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` gives the factories something to close over
 * instead (see `src/app/(admin)/money/page.test.tsx`).
 */
const {
  requireAdmin, listSeasons, listPeopleForSeason, listUnlinkedNames, resolveName, notFound,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listSeasons: vi.fn(),
  listPeopleForSeason: vi.fn(),
  listUnlinkedNames: vi.fn(),
  resolveName: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/members/people-list', () => ({ listPeopleForSeason }));
vi.mock('@/lib/members/identity', () => ({ listUnlinkedNames, resolveName }));
vi.mock('@/lib/work/coverage', () => ({ responsibilitiesOf: vi.fn(async () => []) }));
vi.mock('@/lib/members/change-log', () => ({ personChangeLog: vi.fn(async () => []) }));
vi.mock('next/navigation', () => ({
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: () => {} }),
  usePathname: () => '/members',
  useSearchParams: () => new URLSearchParams(),
}));
/** `./actions` is a `'use server'` module whose graph reaches `@/db`. */
vi.mock('./actions', () => ({
  linkNameAction: vi.fn(), promoteNameAction: vi.fn(),
  createPersonAction: vi.fn(), addMemberAction: vi.fn(),
}));

import { ToastProvider } from '@/components/ui/toaster';
import MembersPage from './page';

const SEASON_26 = { id: 's26', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35, startsOn: null };
const SEASON_25 = { id: 's25', name: 'ברן 25', year: 2025, flatRate: '1500.00', plannedSize: 30, startsOn: null };

function dues(overrides: Partial<PersonDues> = {}): PersonDues {
  return {
    dueId: 'd1', amountAgorot: 120000, paidAgorot: 0, outstandingAgorot: 120000,
    kind: 'flat', exceptionReason: null, state: 'unpaid', ...overrides,
  };
}

function row(overrides: Partial<PersonListRow> = {}): PersonListRow {
  return {
    personId: 'p1',
    displayName: 'רוני אדלר',
    aliases: [],
    role: 'member',
    seasons: [{ seasonId: 's26', name: 'ברן 26', year: 2026, role: 'member' }],
    dues: null,
    outstandingAgorot: 0,
    taskCount: 0,
    lastActivityAt: new Date('2026-09-01T10:00:00Z'),
    onScopeSeason: true,
    newThisSeason: false,
    lapsed: false,
    ...overrides,
  };
}

/* The real tree gets its provider from `(admin)/layout.tsx`; the bulk bar
   reports its writes through it, and `useToast` throws without one on purpose. */
async function renderPage(params: Record<string, string> = {}) {
  return render(
    <ToastProvider>{await MembersPage({ searchParams: Promise.resolve(params) })}</ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listSeasons.mockResolvedValue([SEASON_26, SEASON_25]);
  listPeopleForSeason.mockResolvedValue([]);
  listUnlinkedNames.mockResolvedValue([]);
  resolveName.mockResolvedValue({ personId: null, candidates: [] });
});

describe('/members — the gate', () => {
  it('refuses before it reads anything at all', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(listPeopleForSeason).not.toHaveBeenCalled();
  });
});

describe('/members — the saved views', () => {
  const people = [
    row({ personId: 'a', displayName: 'רוני אדלר', role: 'lead', aliases: ['Roni A.'] }),
    row({ personId: 'b', displayName: 'נועה לוי', newThisSeason: true }),
    row({ personId: 'c', displayName: 'דניאל שפירא', onScopeSeason: false, lapsed: true, seasons: [{ seasonId: 's25', name: 'ברן 25', year: 2025, role: 'member' }] }),
  ];

  it('names the season tab after the season, because "the roster" is not a thing a lead thinks in', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    await renderPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('ברן 26')]),
    );
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('כולם')]),
    );
  });

  it('counts every tab against the whole roster', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    await renderPage();
    const tab = (label: string) => screen.getAllByRole('tab')
      .find((t) => t.textContent?.includes(label))!;
    expect(tab('כולם').textContent).toContain('3');
    expect(tab('ברן 26').textContent).toContain('2');
    expect(tab('ראשי צוות').textContent).toContain('1');
    expect(tab('חדשים השנה').textContent).toContain('1');
    expect(tab('לא חזרו השנה').textContent).toContain('1');
  });

  it('selects exactly the view the URL names, and shows only its people', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    await renderPage({ view: 'leads' });
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('ראשי צוות');
    expect(screen.getByRole('link', { name: 'רוני אדלר' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'נועה לוי' })).toBeNull();
  });

  it('finds a person by the spelling that matched, not only by their display name', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    await renderPage({ view: 'all', q: 'Roni' });
    expect(screen.getByRole('link', { name: 'רוני אדלר' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'נועה לוי' })).toBeNull();
  });

  /*
   * The two counts answer different questions. If the tab counts were taken
   * from the filtered rows they would all collapse to the row count while a
   * lead typed, which is the bug this pins.
   */
  it('shrinks the row count while a search runs, and leaves the tab counts alone', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    await renderPage({ view: 'all', q: 'Roni' });
    expect(screen.getByText('1 שורות')).toBeTruthy();
    const all = screen.getAllByRole('tab').find((t) => t.textContent?.includes('כולם'))!;
    expect(all.textContent).toContain('3');
  });
});

describe('/members — the totals row', () => {
  const people = [
    row({ personId: 'a', displayName: 'אופק כהן', outstandingAgorot: 0, taskCount: 2, dues: dues({ paidAgorot: 120000, outstandingAgorot: 0, state: 'paid' }) }),
    row({ personId: 'b', displayName: 'נועה לוי', outstandingAgorot: 70000, taskCount: 1, dues: dues({ paidAgorot: 50000, outstandingAgorot: 70000, state: 'partial' }) }),
    row({ personId: 'c', displayName: 'תמר גולן', outstandingAgorot: 120000, taskCount: 0, dues: dues({ state: 'unpaid' }) }),
    row({ personId: 'd', displayName: 'ליאור קפלן', outstandingAgorot: 0, taskCount: 0, dues: null }),
  ];

  it('sums the rows it is showing, so the footer can never disagree with them', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    const { container } = await renderPage();
    const foot = container.querySelector('tfoot')!;
    expect(within(foot as HTMLElement).getByText('סה״כ 4 בברן 26')).toBeTruthy();
    expect(within(foot as HTMLElement).getByText('שילמו 1 · חלקית 1 · טרם 1 · בלי חיוב 1')).toBeTruthy();
    expect(within(foot as HTMLElement).getByText('1,900 ₪')).toBeTruthy();
    expect(within(foot as HTMLElement).getByText('3')).toBeTruthy();
  });

  it('re-totals when the view changes, because it totals what is on screen', async () => {
    listPeopleForSeason.mockResolvedValue(people);
    const { container } = await renderPage({ view: 'unpaid' });
    const foot = container.querySelector('tfoot')!;
    expect(within(foot as HTMLElement).getByText('סה״כ 2 בטרם שילמו')).toBeTruthy();
    expect(within(foot as HTMLElement).getByText('1,900 ₪')).toBeTruthy();
  });
});

describe('/members — the empty states', () => {
  it('invites a first person when the camp has none at all', async () => {
    listPeopleForSeason.mockResolvedValue([]);
    await renderPage({ view: 'all' });
    expect(screen.getByText('אין כאן כלום עדיין')).toBeTruthy();
    expect(screen.getByText('כאן יופיעו אנשים. עדיין לא נוספו.')).toBeTruthy();
  });

  it('names the season when the camp has people but this year has none', async () => {
    listPeopleForSeason.mockResolvedValue([
      row({ personId: 'c', onScopeSeason: false, seasons: [] }),
    ]);
    await renderPage({ view: 'roster' });
    expect(screen.getByText('אין כאן כלום לשנה הזו')).toBeTruthy();
    expect(screen.getByText('אין אנשים בברן 26. בשנים אחרות ייתכן שיש.')).toBeTruthy();
  });

  it('offers to drop the filter rather than apologising for it', async () => {
    listPeopleForSeason.mockResolvedValue([row({ personId: 'a', displayName: 'אופק כהן' })]);
    await renderPage({ view: 'all', q: 'לא קיים' });
    expect(screen.getByText('אין תוצאות לסינון הזה')).toBeTruthy();
    const clear = screen.getByRole('link', { name: 'ניקוי הסינון' });
    expect(clear.getAttribute('href')).not.toContain('q=');
  });

  /* The only one that celebrates — and only here. Everywhere else an empty
     list is a fact, not good news. */
  it('celebrates only in טרם שילמו', async () => {
    listPeopleForSeason.mockResolvedValue([
      row({ personId: 'a', dues: dues({ paidAgorot: 120000, outstandingAgorot: 0, state: 'paid' }) }),
    ]);
    await renderPage({ view: 'unpaid' });
    expect(screen.getByText('הכול מטופל')).toBeTruthy();

    await renderPage({ view: 'leads' });
    expect(screen.getAllByText('הכול מטופל')).toHaveLength(1);
  });
});

describe('/members — the names waiting to be attributed', () => {
  /*
   * D3 sends this queue to /inbox, which plan 05 builds in wave 3. Until it
   * exists the queue stays here rather than being deleted: an unresolved name
   * that is on no screen at all is exactly the silent decision the platform
   * forbids, and a banner pointing at a route that 404s is worse than both.
   */
  it('keeps the queue on this screen and links nowhere that does not exist', async () => {
    listUnlinkedNames.mockResolvedValue([{ aliasId: 'al1', alias: 'רוני' }]);
    resolveName.mockResolvedValue({
      personId: null,
      candidates: [{ personId: 'a', displayName: 'רוני אדלר', exact: false }],
    });
    listPeopleForSeason.mockResolvedValue([row({ personId: 'a', displayName: 'רוני אדלר' })]);
    const { container } = await renderPage();

    expect(screen.getByText('שמות שממתינים לשיוך')).toBeTruthy();
    expect(screen.getByRole('button', { name: /קשר לרוני אדלר/ })).toBeTruthy();
    expect(container.querySelector('a[href^="/inbox"]')).toBeNull();
  });
});

describe('/members — the drawers', () => {
  it('renders no drawer when the URL names none', async () => {
    listPeopleForSeason.mockResolvedValue([row()]);
    const { container } = await renderPage();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens a peek on the person the URL names', async () => {
    listPeopleForSeason.mockResolvedValue([row({ personId: 'p1', displayName: 'רוני אדלר' })]);
    await renderPage({ peek: 'p1' });
    expect(screen.getByRole('dialog', { name: 'רוני אדלר' })).toBeTruthy();
  });

  /*
   * A peek link is meant to be pasted. The person who opens it has whatever
   * filter the sender had — or none — so the id is looked up against the
   * unfiltered roster. Resolving it against the filtered rows would make a
   * shared link open an empty list about half the time.
   */
  it('opens a peek pasted with a filter that hides the person it names', async () => {
    listPeopleForSeason.mockResolvedValue([
      row({ personId: 'p1', displayName: 'רוני אדלר', role: 'member' }),
    ]);
    await renderPage({ view: 'leads', peek: 'p1' });
    expect(screen.getByRole('dialog', { name: 'רוני אדלר' })).toBeTruthy();
  });

  it('renders no drawer at all when the peek names nobody', async () => {
    listPeopleForSeason.mockResolvedValue([row({ personId: 'p1' })]);
    const { container } = await renderPage({ peek: 'ghost' });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
