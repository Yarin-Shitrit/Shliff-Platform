/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { DebtRow } from '@/lib/money/debts-view';
import type { SourceCell } from '@/lib/money/trace';

const { requireAdmin, listSeasons, listAccounts, listDebts } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), listSeasons: vi.fn(), listAccounts: vi.fn(), listDebts: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/accounts', () => ({ listAccounts }));
/**
 * Only the reader is replaced. `debtTotals` and `applyDebtView` stay real —
 * they are the arithmetic this screen displays, and a stubbed total would let
 * a subtotal agree with a fixture instead of with the rows above it.
 */
vi.mock('@/lib/money/debts-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money/debts-view')>()),
  listDebts,
}));

import DebtsPage from './page';

const SEASON = {
  id: 's1', name: 'ברן 26', year: 2026, flatRate: '1200.00',
  plannedSize: 35, startsOn: null,
};

function cell(over: Partial<SourceCell> = {}): SourceCell {
  return {
    blockId: 'b1', sheetId: 'sh1', sheetName: 'סיכום כללי', filename: '2026.xlsx',
    sheetRow: 44, reference: 'סיכום כללי!D44', ...over,
  };
}

function debt(over: Partial<DebtRow> = {}): DebtRow {
  return {
    id: 'o1', direction: 'camp_owes', partyPersonId: null, partyName: 'רוני אדלר',
    displayParty: 'רוני אדלר', description: 'מקדמה לגנרטור', amountAgorot: 1524000,
    settledAgorot: 0, outstandingAgorot: 1524000, settled: false, unnamed: false,
    openedOn: new Date('2026-07-02T00:00:00Z'), seasonId: 's1',
    sourceBlockId: null, sourceRow: null, settlements: [],
    dateless: false, source: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listSeasons.mockResolvedValue([SEASON]);
  listAccounts.mockResolvedValue([]);
  listDebts.mockResolvedValue([]);
});

async function renderPage(params: Record<string, string> = {}) {
  render(await DebtsPage({ searchParams: Promise.resolve({ season: 's1', ...params }) }));
}

describe('the debts screen', () => {
  it('heads each direction with its own subtotal and never nets the two', async () => {
    listDebts.mockResolvedValue([
      debt({ id: '1', direction: 'camp_owes', amountAgorot: 1524000,
             settledAgorot: 1433000, outstandingAgorot: 91000, displayParty: 'רוני אדלר' }),
      debt({ id: '2', direction: 'owed_to_camp', amountAgorot: 235000,
             outstandingAgorot: 235000, displayParty: 'מאיה פרץ' }),
    ]);
    await renderPage();
    /**
     * Each direction shows its own figure and never the other's. Asserted
     * both ways round rather than by a single `getByText`, because a
     * direction legitimately repeats its subtotal — in its heading, in the
     * row's נותר cell and in the footer — and a query that tripped over that
     * would have to be weakened to something that no longer checks which
     * direction the figure belongs to.
     */
    const owe = screen.getByRole('group', { name: 'אנחנו חייבים' });
    expect(within(owe).getAllByText('910 ₪').length).toBeGreaterThan(0);
    expect(within(owe).queryByText('2,350 ₪')).toBeNull();
    const owed = screen.getByRole('group', { name: 'חייבים לנו' });
    expect(within(owed).getAllByText('2,350 ₪').length).toBeGreaterThan(0);
    expect(within(owed).queryByText('910 ₪')).toBeNull();
    // 910 against 2,350 is not −1,440 of anything: the camp owing one person
    // and another owing the camp are two facts, and a single netted figure
    // would be a number nobody could act on.
    expect(screen.queryByText(/-/)).toBeNull();
  });

  it('shows how much of a debt has been settled, as a meter and as words', async () => {
    listDebts.mockResolvedValue([debt({
      id: '1', amountAgorot: 1524000, settledAgorot: 1433000, outstandingAgorot: 91000,
    })]);
    await renderPage();
    // A17: one isolate around the whole phrase. Two — one per number — would
    // break this very query, because getNodeText reads only direct children.
    expect(screen.getByText('14,330 מתוך 15,240')).toBeTruthy();
  });

  it('says a dateless debt has no date, and puts it last', async () => {
    listDebts.mockResolvedValue([
      debt({ id: '1', description: 'מקדמה לגנרטור', dateless: false,
             openedOn: new Date('2026-07-02T00:00:00Z') }),
      debt({ id: '2', description: 'החזר על מקררים', dateless: true, openedOn: null }),
    ]);
    await renderPage();
    /**
     * Scoped to one direction's `<tbody>`. A bare `getAllByRole('row')` spans
     * both direction tables and picks up each one's header and totals rows,
     * so `.at(-1)` was landing on the *other* table's empty state — a query
     * matching something other than what it meant.
     */
    const owe = screen.getByRole('group', { name: 'אנחנו חייבים' });
    const texts = within(owe).getAllByRole('row')
      .filter((tr) => tr.closest('tbody') !== null)
      .map((tr) => tr.textContent ?? '');
    expect(texts.findIndex((text) => text.includes('החזר על מקררים')))
      .toBeGreaterThan(texts.findIndex((text) => text.includes('מקדמה לגנרטור')));
    // Verbatim from the promoter's own note for a dateless debt, so the
    // register and this screen say the same thing about the same row.
    expect(screen.getByText('בגיליון אין תאריך לחוב הזה')).toBeTruthy();
  });

  it('cannot settle a nameless debt, and says why on the button itself', async () => {
    listDebts.mockResolvedValue([debt({
      id: '1', unnamed: true, displayParty: null, partyName: null,
      description: 'שולם 500 — מקפיא באיחסון נוסף',
      amountAgorot: 50000, outstandingAgorot: 50000, source: cell(),
    })]);
    await renderPage();
    const button = screen.getByRole('button', { name: 'סגירה' });
    expect(button.hasAttribute('disabled')).toBe(true);
    const described = document.getElementById(button.getAttribute('aria-describedby')!);
    // Verbatim from settleObligation. The screen must not paraphrase a
    // refusal the library will make.
    expect(described!.textContent).toBe('אי אפשר לסגור חוב בלי שם — לא ידוע למי מגיע הכסף');
    expect(screen.getByText('חסר שם')).toBeTruthy();
  });

  it('offers no way to dismiss a nameless debt, and keeps its source cell', async () => {
    listDebts.mockResolvedValue([debt({
      id: '1', unnamed: true, displayParty: null, partyName: null, source: cell(),
    })]);
    await renderPage();
    expect(screen.queryByRole('button', { name: /התעלמות|הסרה|מחיקה/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /התעלמות|הסרה|מחיקה/ })).toBeNull();
    expect(screen.getByText('סיכום כללי!D44')).toBeTruthy();
  });

  it('says nameless debts belong to no season, and shows them anyway', async () => {
    listDebts.mockResolvedValue([debt({
      id: '1', unnamed: true, displayParty: null, partyName: null,
      amountAgorot: 54000, outstandingAgorot: 54000, seasonId: null,
    })]);
    await renderPage();
    const banner = screen.getByRole('status');
    expect(within(banner).getByText(/1 חובות בלי שם/)).toBeTruthy();
    expect(within(banner).getByText(/אי אפשר לסגור אותם עד שיירשם למי מגיע הכסף/)).toBeTruthy();
    expect(within(banner).getByText(/מוצגים בכל השנים/)).toBeTruthy();
  });

  it('counts what was closed by קיזוז and says it moved through no קופה', async () => {
    listDebts.mockResolvedValue([debt({
      id: '1', amountAgorot: 1524000, settledAgorot: 600000, outstandingAgorot: 924000,
      settlements: [{
        id: 's1', amountAgorot: 600000, kind: 'offset', ledgerEntryId: null,
        paymentId: null, note: 'יוסף קארינה יונתן ירין ועילאי',
        settledOn: new Date('2026-07-20T00:00:00Z'),
      }],
    })]);
    await renderPage();
    expect(screen.getByText('נסגר בקיזוז')).toBeTruthy();
    expect(screen.getByText('לא עברו דרך אף קופה')).toBeTruthy();
    expect(screen.getByText('6,000 ₪')).toBeTruthy();
  });

  it('is not found for a signed-in non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow();
  });
});
