/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { LedgerRow } from '@/lib/money/ledger-view';
import type { SourceCell } from '@/lib/money/trace';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws — `vi.hoisted` gives the
 * factories something to close over instead.
 */
const { requireAdmin, listSeasons, listAccounts, listLedgerRows, runningBalanceFor } =
  vi.hoisted(() => ({
    requireAdmin: vi.fn(), listSeasons: vi.fn(), listAccounts: vi.fn(),
    listLedgerRows: vi.fn(), runningBalanceFor: vi.fn(),
  }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/accounts', () => ({ listAccounts }));
/**
 * Only the two database readers are replaced. `applyLedgerView`, `viewCounts`,
 * `ledgerStrip` and `groupByMonth` stay the real functions: they are the
 * arithmetic this screen is a display of, and a stubbed `ledgerStrip` would
 * let the strip agree with a fixture instead of with the table beneath it.
 */
vi.mock('@/lib/money/ledger-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money/ledger-view')>()),
  listLedgerRows, runningBalanceFor,
}));

import LedgerPage from './page';

const SEASON = {
  id: 's1', name: 'ברן 26', year: 2026, flatRate: '1200.00',
  plannedSize: 35, startsOn: null,
};

function cell(over: Partial<SourceCell> = {}): SourceCell {
  return {
    blockId: 'b1', sheetId: 'sh1', sheetName: 'סיכום כללי', filename: '2026.xlsx',
    sheetRow: 14, reference: 'סיכום כללי!A14', ...over,
  };
}

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r1', origin: 'ledger', occurredOn: new Date('2026-09-15T00:00:00Z'),
    direction: 'in', amountAgorot: 1850000, description: 'הכנסות מסיבת גיוס',
    accountId: 'a1', accountName: 'קופת מסיבות', counterpartName: null,
    counterpartPersonId: null, isTransfer: false, budgetLineId: null,
    budgetLineLabel: null, seasonId: 's1', source: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
  listSeasons.mockResolvedValue([SEASON]);
  listAccounts.mockResolvedValue([]);
  listLedgerRows.mockResolvedValue([]);
  runningBalanceFor.mockResolvedValue({ shown: false, reason: 'אין' });
});

async function renderPage(params: Record<string, string> = {}) {
  render(await LedgerPage({ searchParams: Promise.resolve({ season: 's1', ...params }) }));
}

describe('the movements table', () => {
  it('puts every amount in its own positive column, never a signed one', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', direction: 'in', amountAgorot: 1850000, description: 'הכנסות מסיבת גיוס' }),
      row({ id: '2', direction: 'out', amountAgorot: 387500, description: 'השכרת משאית' }),
    ]);
    await renderPage();
    const incoming = screen.getByRole('row', { name: /הכנסות מסיבת גיוס/ });
    expect(within(incoming).getByText('18,500 ₪')).toBeTruthy();
    const outgoing = screen.getByRole('row', { name: /השכרת משאית/ });
    expect(within(outgoing).getByText('3,875 ₪')).toBeTruthy();
    expect(screen.queryByText(/-3,875/)).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'נכנס' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'יצא' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'מ/אל' })).toBeTruthy();
  });

  it('heads each month with its name, its year and how many movements it holds', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', occurredOn: new Date('2026-09-15T00:00:00Z') }),
      row({ id: '2', occurredOn: new Date('2026-09-08T00:00:00Z') }),
      row({ id: '3', occurredOn: new Date('2026-08-28T00:00:00Z') }),
    ]);
    await renderPage();
    expect(screen.getByText('ספטמבר 2026 · 2 תנועות')).toBeTruthy();
    expect(screen.getByText('אוגוסט 2026 · 1 תנועות')).toBeTruthy();
  });

  it('shows the workbook cell for a promoted row and נרשם ידנית for a typed one', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', description: 'מיובא', source: cell() }),
      row({ id: '2', description: 'ידני', source: null }),
    ]);
    await renderPage();
    expect(within(screen.getByRole('row', { name: /מיובא/ })).getByText('סיכום כללי!A14'))
      .toBeTruthy();
    expect(within(screen.getByRole('row', { name: /ידני/ })).getByText('נרשם ידנית')).toBeTruthy();
  });

  it('names the counterpart where there is one, and shows a dash where there is none', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', origin: 'dues', description: 'דמי קאמפ — נועה לוי',
            counterpartName: 'נועה לוי', counterpartPersonId: 'p1' }),
      row({ id: '2', description: 'קניות למטבח', counterpartName: null }),
    ]);
    await renderPage();
    expect(screen.getByRole('link', { name: 'נועה לוי' }).getAttribute('href'))
      .toBe('/members/p1');
    /**
     * Queried by the sentence, not by the glyph. Four cells in this row can
     * be empty — counterpart, budget line, and whichever of נכנס/יצא the
     * movement is not — and every one of them draws the same em dash, so
     * `getByText('—')` would match several and could pass for the wrong one.
     * That is the A25 failure mode exactly.
     *
     * So the dash is `aria-hidden` everywhere (a screen reader gains nothing
     * from "em dash"), and the one absence that is a *fact about the row* —
     * the model knows of no counterpart, and will not parse one out of the
     * description — carries an sr-only sentence saying so. The visible cell
     * is still the dash the mock draws.
     */
    const plain = screen.getByRole('row', { name: /קניות למטבח/ });
    expect(within(plain).getByText('אין צד שני רשום')).toBeTruthy();
  });

  it('marks a movement with no account rather than leaving the cell blank', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', description: 'מים וקרח', accountId: null, accountName: null }),
    ]);
    await renderPage();
    expect(within(screen.getByRole('row', { name: /מים וקרח/ })).getByText('לא צוין')).toBeTruthy();
  });

  it('marks both legs of a transfer as one', async () => {
    listLedgerRows.mockResolvedValue([
      row({ id: '1', description: 'העברה לקופת מסיבות', isTransfer: true,
            counterpartName: 'קופת מסיבות' }),
    ]);
    await renderPage();
    expect(within(screen.getByRole('row', { name: /העברה לקופת מסיבות/ })).getByText('העברה'))
      .toBeTruthy();
  });

  it('is not found for a signed-in non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(renderPage()).rejects.toThrow();
  });
});

describe('the running balance column', () => {
  it('shows it for one account in order', async () => {
    listLedgerRows.mockResolvedValue([row({ id: '1' })]);
    runningBalanceFor.mockResolvedValue({
      shown: true, openingAgorot: 4464700, balancesAgorot: [6314700],
    });
    await renderPage({ account: 'a1', sort: 'date-asc' });
    expect(screen.getByRole('columnheader', { name: 'יתרה' })).toBeTruthy();
    expect(screen.getByText('63,147 ₪')).toBeTruthy();
  });

  it('hides the column and explains itself in one line when it cannot be true', async () => {
    listLedgerRows.mockResolvedValue([row({ id: '1' })]);
    runningBalanceFor.mockResolvedValue({
      shown: false,
      reason: 'יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.',
    });
    await renderPage();
    expect(screen.queryByRole('columnheader', { name: 'יתרה' })).toBeNull();
    expect(screen.getByText('יתרה רצה מוצגת רק כשבוחרים חשבון אחד. בתצוגה הזו יש כמה חשבונות.'))
      .toBeTruthy();
  });
});

/**
 * E1 asks for all five of C10's states. Only three can occur on this screen:
 * `not-permitted` is served by the guard's `notFound()` (covered above), and
 * `all-clear` is refused outright — an empty register is never good news.
 * The kit owns every sentence; this screen supplies a noun, a season name and
 * a filter summary, so the copy asserted here is C10's, not a local dialect.
 */
describe('the empty states', () => {
  it('invites an import when nothing has ever been recorded', async () => {
    await renderPage();
    expect(screen.getByText('כאן יופיעו תנועות. עדיין לא נוספו.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'לדף הייבוא' }).getAttribute('href')).toBe('/upload');
  });

  it('says the season is empty rather than the camp, when another season exists', async () => {
    listSeasons.mockResolvedValue([SEASON, { ...SEASON, id: 's0', name: 'ברן 25', year: 2025 }]);
    await renderPage();
    expect(screen.getByText('אין תנועות בברן 26. בשנים אחרות ייתכן שיש.')).toBeTruthy();
  });

  it('says a filter is empty rather than the season, and names the filter it would clear', async () => {
    listLedgerRows.mockResolvedValue([row({ id: '1', direction: 'in' })]);
    await renderPage({ view: 'out' });
    expect(screen.getByText('נסו להסיר את הסינון ״יצא״.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ניקוי הסינון' })).toBeTruthy();
  });

  it('never congratulates a lead on an empty register', async () => {
    await renderPage();
    expect(screen.queryByText('הכול מטופל')).toBeNull();
  });
});
