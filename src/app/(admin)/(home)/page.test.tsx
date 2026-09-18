/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
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
