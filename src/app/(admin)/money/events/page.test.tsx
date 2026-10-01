/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PartySummary } from '@/lib/money/parties';

const { requireAdmin, listSeasons, listParties } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), listSeasons: vi.fn(), listParties: vi.fn(),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/money/events',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/parties', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money/parties')>()),
  listParties,
}));

import EventsPage from './page';

const SEASON = {
  id: 's1', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35, startsOn: null,
};

function party(over: Partial<PartySummary> = {}): PartySummary {
  return {
    id: 'p1', name: 'מסיבת פקאנים', seasonId: 's1', seasonName: 'ברן 26',
    heldOn: new Date('2026-03-01T00:00:00Z'), partnerName: null,
    ticketsAgorot: 0, barAgorot: 0, costAgorot: 0, partnerInAgorot: 0, partnerOutAgorot: 0,
    unsortedInAgorot: 0, unsortedOutAgorot: 0, netAgorot: 0, count: 0, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listSeasons.mockResolvedValue([SEASON]);
  listParties.mockResolvedValue([]);
});

async function renderPage(params: Record<string, string> = {}) {
  render(await EventsPage({ searchParams: Promise.resolve(params) }));
}

describe('the parties page', () => {
  it('is not found for a caller who is not an admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(EventsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });

  it('invites the first party when there are none', async () => {
    await renderPage();
    const links = screen.getAllByRole('link', { name: 'מסיבה חדשה' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toBe('/money/events?act=party');
  });

  it('shows what each party left the camp, and links to the party', async () => {
    listParties.mockResolvedValue([
      party({
        ticketsAgorot: 1000000, barAgorot: 400000, costAgorot: 600000, netAgorot: 800000, count: 3,
      }),
    ]);
    await renderPage();
    const table = screen.getByRole('table', { name: 'מסיבות' });
    const link = within(table).getByRole('link', { name: 'מסיבת פקאנים' });
    expect(link.getAttribute('href')).toBe('/money/events/p1');
    expect(within(table).getAllByText('8,000 ₪').length).toBeGreaterThan(0);
  });

  it('shows the partner column only when some party was shared', async () => {
    listParties.mockResolvedValue([party()]);
    await renderPage();
    expect(screen.queryByRole('columnheader', { name: 'מול השותף' })).toBeNull();

    document.body.innerHTML = '';
    listParties.mockResolvedValue([
      party({ partnerName: 'וייבז', partnerOutAgorot: 200000, netAgorot: -200000, count: 1 }),
    ]);
    await renderPage();
    expect(screen.getByRole('columnheader', { name: 'מול השותף' })).toBeTruthy();
    expect(screen.getByText('וייבז')).toBeTruthy();
  });

  it('says a party has no money yet rather than showing a zero result', async () => {
    listParties.mockResolvedValue([party()]);
    await renderPage();
    expect(screen.getByText('עוד לא נרשם כסף')).toBeTruthy();
  });

  it('flags money on a party that nobody sorted', async () => {
    listParties.mockResolvedValue([party({ unsortedInAgorot: 100, netAgorot: 100, count: 1 })]);
    await renderPage();
    expect(screen.getByText('יש תנועות לא מסווגות')).toBeTruthy();
  });

  it('ranks by what was left when asked', async () => {
    listParties.mockResolvedValue([
      party({ id: 'a', name: 'קטנה', netAgorot: 100, count: 1 }),
      party({ id: 'b', name: 'גדולה', netAgorot: 900, count: 1 }),
    ]);
    await renderPage({ sort: 'net' });
    const names = screen.getAllByRole('link')
      .map((one) => one.textContent)
      .filter((text) => text === 'קטנה' || text === 'גדולה');
    expect(names).toEqual(['גדולה', 'קטנה']);
  });

  it('opens the new-party drawer from the URL', async () => {
    await renderPage({ act: 'party' });
    expect(screen.getByRole('dialog', { name: 'מסיבה חדשה' })).toBeTruthy();
    expect(screen.getByLabelText(/שם המסיבה/)).toBeTruthy();
  });
});
