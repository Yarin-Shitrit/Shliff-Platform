/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AdminCheck } from '@/lib/auth/guard';
import type { ExpenseRow } from '@/lib/money/expenses';

const {
  grants, requireAdmin, listSeasons, listAccounts, listOwnExpenses,
} = vi.hoisted(() => ({
  grants: { current: {} as Record<string, unknown> },
  requireAdmin: vi.fn(), listSeasons: vi.fn(), listAccounts: vi.fn(), listOwnExpenses: vi.fn(),
}));

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/accounts', () => ({ listAccounts }));
vi.mock('@/lib/money/expenses', () => ({ listOwnExpenses }));
/* Client components with their own tests; here stand-ins that print what the
   page handed them, so this file tests the wiring only. */
vi.mock('./expense-form', () => ({
  ExpenseForm: (props: { seasonId: string; accounts: Array<{ name: string }>; today: string }) => (
    <div data-testid="form">
      {props.seasonId} · {props.accounts.map((one) => one.name).join(',')} · {props.today}
    </div>
  ),
}));
vi.mock('./expense-tools', () => ({
  ExpenseTools: (props: { expenseId: string; editHref: string | null }) => (
    <span data-testid={`tools-${props.expenseId}`}>{props.editHref ?? 'no-edit'}</span>
  ),
}));

import ExpensesPage from './page';

const SEASONS = [
  { id: 's1', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35, startsOn: null },
  { id: 's0', name: 'ברן 25', year: 2025, flatRate: '1100.00', plannedSize: 30, startsOn: null },
];
const BUYER = 'buyer@example.com';

function expense(over: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: 'e1', occurredOn: new Date('2026-11-18T00:00:00Z'), amountAgorot: 18450,
    description: 'קרח ומים', category: 'food', accountName: 'קופת מזומן', accountFund: 'camp',
    hasReceipt: true, ...over,
  };
}

function allow(map: Record<string, AdminCheck>) {
  grants.current = map;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockImplementation(async (page: string, need: string = 'view') => {
    const grant = grants.current[page] as AdminCheck | undefined;
    if (grant === undefined || !grant.ok) return { ok: false };
    if (need === 'edit' && grant.level !== 'edit') return { ok: false };
    return grant;
  });
  allow({ expenses: { ok: true, email: BUYER, level: 'edit' } });
  listSeasons.mockResolvedValue(SEASONS);
  listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופת מזומן', fund: 'camp' }]);
  listOwnExpenses.mockResolvedValue([]);
});

async function renderPage(params: Record<string, string> = {}) {
  render(await ExpensesPage({ searchParams: Promise.resolve(params) }));
}

describe('the expenses page', () => {
  it('is closed to an account without the grant, as a not-found', async () => {
    allow({});
    await expect(ExpensesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(listOwnExpenses).not.toHaveBeenCalled();
  });

  it('asks for the expenses grant, not the ledger\'s, to open', async () => {
    await renderPage();
    expect(requireAdmin.mock.calls[0]).toEqual(['expenses']);
  });

  it('reads only what the signed-in account recorded, for the newest season by default', async () => {
    await renderPage();
    expect(listOwnExpenses).toHaveBeenCalledWith({}, { recordedBy: BUYER, seasonId: 's1' });
    expect(screen.getByTestId('form').textContent).toContain('s1 · קופת מזומן · ');
  });

  it('keeps the season the URL names', async () => {
    await renderPage({ season: 's0' });
    expect(listOwnExpenses).toHaveBeenCalledWith({}, { recordedBy: BUYER, seasonId: 's0' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('ברן 25');
  });

  it('invites rather than apologises when nothing was recorded yet', async () => {
    await renderPage();
    expect(screen.getByTestId('form')).toBeTruthy();
    expect(screen.getByText(/אין הוצאות שרשמת בברן 26/)).toBeTruthy();
  });

  it('lists each expense with its category, account, amount and a link to its receipt', async () => {
    listOwnExpenses.mockResolvedValue([
      expense(),
      expense({ id: 'e2', description: 'ברגים', category: null, hasReceipt: false, amountAgorot: 4000 }),
    ]);
    await renderPage();
    const table = screen.getByRole('table');
    const first = within(table).getByText('קרח ומים').closest('tr')!;
    expect(first.textContent).toContain('אוכל ושתייה');
    expect(first.textContent).toContain('קופת מזומן');
    expect(first.textContent).toContain('184.50');
    const link = within(first).getByRole('link', { name: 'הקבלה של קרח ומים' });
    expect(link.getAttribute('href')).toBe('/money/expenses/receipt/e1');

    const second = within(table).getByText('ברגים').closest('tr')!;
    expect(within(second).queryByRole('link')).toBeNull();
    // The total is of the rows on screen: 184.50 + 40.00.
    expect(table.textContent).toContain('224.50');
    expect(table.textContent).toContain('2 הוצאות');
  });

  it('gives an expenses-only account no link into the ledger it cannot open', async () => {
    listOwnExpenses.mockResolvedValue([expense()]);
    await renderPage();
    expect(screen.getByTestId('tools-e1').textContent).toBe('no-edit');
    expect(screen.queryByRole('link', { name: 'לכל ההוצאות בתנועות' })).toBeNull();
  });

  it('gives a ledger editor the correction link, with the season kept', async () => {
    allow({
      expenses: { ok: true, email: BUYER, level: 'edit' },
      ledger: { ok: true, email: BUYER, level: 'edit' },
    });
    listOwnExpenses.mockResolvedValue([expense()]);
    await renderPage();
    expect(screen.getByTestId('tools-e1').textContent)
      .toBe('/money/ledger?season=s1&peek=e1&act=edit');
    expect(screen.getByRole('link', { name: 'לכל ההוצאות בתנועות' }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&view=out');
  });

  it('shows a view-only account its list and says why there is no form', async () => {
    allow({ expenses: { ok: true, email: BUYER, level: 'view' } });
    listOwnExpenses.mockResolvedValue([expense()]);
    await renderPage();
    expect(screen.queryByTestId('form')).toBeNull();
    expect(screen.getByText(/צפייה בלבד/)).toBeTruthy();
    expect(screen.queryByTestId('tools-e1')).toBeNull();
  });

  it('says there are no seasons instead of offering a form that cannot save', async () => {
    listSeasons.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText(/עדיין אין שנים/)).toBeTruthy();
    expect(screen.queryByTestId('form')).toBeNull();
  });
});
