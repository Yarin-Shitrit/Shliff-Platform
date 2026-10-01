/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PartyDetail, PartyMovement } from '@/lib/money/parties';

const { requireAdmin, partyDetail, listAccounts } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), partyDetail: vi.fn(), listAccounts: vi.fn(),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/money/events/p1',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/money/accounts', () => ({ listAccounts }));
vi.mock('@/lib/money/parties', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money/parties')>()),
  partyDetail,
}));

import PartyPage from './page';

function movement(over: Partial<PartyMovement> = {}): PartyMovement {
  return {
    id: 'e1', occurredOn: new Date('2026-07-18T00:00:00Z'), direction: 'in',
    amountAgorot: 500000, description: 'כרטיסים — SN', part: 'tickets',
    accountId: 'a1', accountName: 'קופה', manual: true, ...over,
  };
}

function detail(over: Partial<PartyDetail> = {}): PartyDetail {
  return {
    id: 'p1', name: 'SN', seasonId: 's1', seasonName: 'ברן 26',
    heldOn: new Date('2026-07-18T00:00:00Z'), partnerName: null,
    ticketsAgorot: 0, barAgorot: 0, costAgorot: 0, partnerInAgorot: 0, partnerOutAgorot: 0,
    unsortedInAgorot: 0, unsortedOutAgorot: 0, netAgorot: 0, count: 0, movements: [], ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה' }]);
  partyDetail.mockResolvedValue(detail());
});

async function renderPage(query: Record<string, string> = {}) {
  render(await PartyPage({
    params: Promise.resolve({ id: 'p1' }),
    searchParams: Promise.resolve(query),
  }));
}

describe('a party\'s page', () => {
  it('is not found for an id that is not a party', async () => {
    partyDetail.mockResolvedValue(undefined);
    await expect(PartyPage({
      params: Promise.resolve({ id: 'nope' }), searchParams: Promise.resolve({}),
    })).rejects.toThrow();
  });

  it('invites the first line of money when there is none', async () => {
    await renderPage();
    const links = screen.getAllByRole('link', { name: 'רישום כסף' });
    expect(links[0].getAttribute('href')).toBe('/money/events/p1?act=movement');
  });

  it('lists each movement with its kind, and offers to delete only what a lead typed', async () => {
    partyDetail.mockResolvedValue(detail({
      count: 2,
      ticketsAgorot: 500000,
      unsortedOutAgorot: 10000,
      netAgorot: 490000,
      movements: [
        movement(),
        movement({
          id: 'e2', direction: 'out', amountAgorot: 10000, description: 'מהגיליון',
          part: null, manual: false,
        }),
      ],
    }));
    await renderPage();
    const table = screen.getByRole('table', { name: 'הכסף של SN' });
    expect(within(table).getAllByText('כרטיסים').length).toBeGreaterThan(0);
    expect(within(table).getByText('לא מסווג')).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'מחיקת כרטיסים — SN' })).toBeTruthy();
    expect(within(table).queryByRole('button', { name: 'מחיקת מהגיליון' })).toBeNull();
    expect(screen.getByText('חלק מהכסף של המסיבה לא מסווג.')).toBeTruthy();
  });

  it('shows what passed to the partner only for a shared party', async () => {
    await renderPage();
    expect(screen.queryByText(/^מול /)).toBeNull();
    expect(screen.getByText(/עשינו לבד/)).toBeTruthy();

    document.body.innerHTML = '';
    partyDetail.mockResolvedValue(detail({ partnerName: 'וייבז', partnerOutAgorot: 300000 }));
    await renderPage();
    expect(screen.getByText('מול וייבז')).toBeTruthy();
  });

  it('offers the partner as a kind of movement only when there is one', async () => {
    partyDetail.mockResolvedValue(detail({ partnerName: 'וייבז' }));
    await renderPage({ act: 'movement' });
    expect(screen.getByRole('radio', { name: 'התחשבנות עם וייבז' })).toBeTruthy();

    document.body.innerHTML = '';
    partyDetail.mockResolvedValue(detail());
    await renderPage({ act: 'movement' });
    expect(screen.queryByRole('radio', { name: /התחשבנות/ })).toBeNull();
    expect(screen.getByRole('radio', { name: 'בר' })).toBeTruthy();
  });
});
