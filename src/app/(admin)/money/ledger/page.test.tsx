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
const {
  requireAdmin, listSeasons, listAccounts, listLedgerRows, runningBalanceFor, listBudgetLines,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(), listSeasons: vi.fn(), listAccounts: vi.fn(),
  listLedgerRows: vi.fn(), runningBalanceFor: vi.fn(), listBudgetLines: vi.fn(),
}));
/**
 * `FilterBar` (C3) is the kit's own client component: its chips and its sort
 * are links, but the search box holds what is being typed and debounces it
 * into the URL. Those three hooks are all it needs. `notFound` is left as the
 * real implementation, because the guard test below asserts that it throws.
 */
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/money/ledger',
  useSearchParams: () => new URLSearchParams('season=s1'),
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/accounts', () => ({ listAccounts }));
vi.mock('@/lib/money/budget', () => ({ listBudgetLines }));
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
  listBudgetLines.mockResolvedValue([]);
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

describe('the saved views and the strip', () => {
  const rows = [
    row({ id: '1', direction: 'in', amountAgorot: 6200000 }),
    row({ id: '2', direction: 'out', amountAgorot: 4527100 }),
    row({ id: '3', direction: 'out', amountAgorot: 120000, accountId: null, accountName: null }),
  ];

  /**
   * Names, not `textContent`. The kit renders the count in its own `<span>`
   * with no separating whitespace, so an exact `textContent` assertion would
   * be pinning the kit's markup rather than this screen's counts. `\s*`
   * tolerates that seam while still failing on a wrong label or a wrong
   * count — which is the claim worth making.
   */
  const TABS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^הכול\s*3$/, 'all'],
    [/^נכנס\s*1$/, 'in'],
    [/^יצא\s*2$/, 'out'],
    [/^בלי חשבון\s*1$/, 'no-account'],
    [/^מהקבצים\s*0$/, 'imported'],
    [/^נרשמו ידנית\s*3$/, 'manual'],
  ];

  it('offers the six views with their counts, and marks the current one', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'out' });
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    for (const [name] of TABS) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: /^יצא\s*2$/ }).getAttribute('aria-selected'))
      .toBe('true');
    const selected = screen.getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });

  it('offers no way to save a view, because nothing here could store one', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage();
    expect(screen.queryByRole('link', { name: 'תצוגה שמורה חדשה' })).toBeNull();
  });

  it('keeps the season on every view link', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'all' });
    expect(screen.getByRole('tab', { name: /בלי חשבון/ }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&view=no-account');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.getAttribute('href')).toMatch(/^\/money\/ledger\?season=s1/);
    }
  });

  it('recomputes the strip with the active view', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'all' });
    const strip = screen.getByRole('group', { name: 'סיכום התנועות המוצגות' });
    expect(within(strip).getByText('נכנס')).toBeTruthy();
    expect(within(strip).getByText('יצא')).toBeTruthy();
    expect(within(strip).getByText('שינוי נטו')).toBeTruthy();
    expect(within(strip).getByText('62,000 ₪')).toBeTruthy();
    expect(within(strip).getByText('46,471 ₪')).toBeTruthy();
    expect(within(strip).getByText('15,529 ₪')).toBeTruthy();
    expect(screen.getByText('המספרים מתעדכנים לפי הסינון הפעיל')).toBeTruthy();
  });

  it('shows the strip for the filtered set, not for everything', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'in' });
    const strip = screen.getByRole('group', { name: 'סיכום התנועות המוצגות' });
    expect(within(strip).getByText('0 ₪')).toBeTruthy();
    // With nothing going out, the net *is* the inflow — so 62,000 stands in
    // two of the three tiles. Asserted as two rather than queried as one,
    // because `getByText` would throw on the duplicate and the honest fix is
    // to say what the arithmetic does.
    expect(within(strip).getAllByText('62,000 ₪')).toHaveLength(2);
    expect(within(strip).queryByText('46,471 ₪')).toBeNull();
  });

  it('carries the search term back into the field so a reader can see what is filtering', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ q: 'משאית' });
    const box = screen.getByRole('searchbox', { name: 'חיפוש בתיאור או במ/אל' });
    expect((box as HTMLInputElement).value).toBe('משאית');
  });

  it('counts the filtered rows in the bar, not the whole ledger', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ view: 'out' });
    expect(screen.getByText('2 שורות')).toBeTruthy();
  });

  /**
   * The running balance is only ever true with no season across it (Task 3),
   * so a screen that could not drop the season would carry a column no lead
   * could ever reach. This is the affordance that keeps it reachable.
   */
  it('offers a way out of the season filter, so the running balance is reachable', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage();
    expect(screen.getByRole('link', { name: 'הסרת הסינון שנה' }).getAttribute('href'))
      .toBe('/money/ledger?season=all');
  });

  /**
   * R5: camp-wide data says so on screen. Two places say it — the lead
   * sentence and the season chip's own value — so each is asserted by the
   * words only it uses. A bare `/כל השנים/` matches both and would pass on
   * either alone.
   */
  it('says so on screen when it is showing every year at once', async () => {
    listLedgerRows.mockResolvedValue(rows);
    await renderPage({ season: 'all' });
    expect(screen.getByText(/כרגע מוצגות כל השנים/)).toBeTruthy();
    expect(screen.getByText('כל השנים')).toBeTruthy();
    expect(screen.getByRole('link', { name: /חזרה ל/ }).getAttribute('href'))
      .toBe('/money/ledger?season=s1');
  });
});

describe('money with no account', () => {
  const unplaced = [
    row({ id: '1', direction: 'in', amountAgorot: 120000, description: 'תרומה',
          accountId: null, accountName: null }),
    row({ id: '2', direction: 'out', amountAgorot: 120000, description: 'מים וקרח',
          accountId: null, accountName: null }),
  ];

  /**
   * `getByRole('status')` carries no name filter because the kit's `Banner`
   * takes no accessible name — reported, not patched, since the kit is
   * read-only here. The page renders exactly one live region, and the
   * assertion below says so, so the query cannot drift onto another.
   */
  it('names unattributed money in both directions, never as one sum', async () => {
    listLedgerRows.mockResolvedValue(unplaced);
    await renderPage();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    const banner = screen.getByRole('status');
    expect(within(banner).getByText(/2 תנועות נרשמו בלי לציין חשבון/)).toBeTruthy();
    expect(within(banner).getByText(/עד שישויכו הן לא נספרות ביתרה של אף קופה/)).toBeTruthy();
    expect(within(banner).getByText(/נרשמו בלי לציין לאיזה חשבון נכנסו/)).toBeTruthy();
    expect(within(banner).getByText(/נרשמו בלי לציין מאיזה חשבון יצאו/)).toBeTruthy();
    // 1,200 in and 1,200 out are not 2,400 of anything. Summing money that
    // arrived somewhere unrecorded with money that left somewhere unrecorded
    // produces a figure that is not a quantity — `unattributedAgorot` already
    // carries that finding, and this is the screen honouring it.
    expect(within(banner).queryByText('2,400 ₪')).toBeNull();
    expect(within(banner).getAllByText('1,200 ₪')).toHaveLength(2);
    expect(within(banner).getByRole('link', { name: 'שיוך לחשבון' }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&act=attribute');
  });

  it('offers the fix on the row itself', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    listLedgerRows.mockResolvedValue([
      row({ id: '1', description: 'מים וקרח', accountId: null, accountName: null }),
    ]);
    await renderPage({ view: 'no-account' });
    expect(screen.getByRole('combobox', { name: 'שיוך מים וקרח לחשבון' })).toBeTruthy();
  });

  /**
   * The bug as reported: "the שיוך לחשבון button is not working". The banner
   * navigated correctly, but the row's select and button sat in the kit's
   * hover-revealed action column at opacity 0, so a lead who followed the
   * banner on a laptop saw the same rows and nothing to press. Asserted
   * through the kit's marker class, which is what its stylesheet keys on.
   */
  it('shows the fix without waiting for a hover, on every unplaced row', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    listLedgerRows.mockResolvedValue(unplaced);
    await renderPage({ view: 'no-account' });
    const cells = document.querySelectorAll('td[data-card="action"]');
    expect(cells.length).toBe(2);
    cells.forEach((cell) => { expect(cell.className).toMatch(/visible/); });
    expect(screen.getByRole('columnheader', { name: 'שיוך לחשבון' })).toBeTruthy();
  });

  /**
   * The banner's verb opens a drawer rather than switching views. It once
   * switched to בלי חשבון and stopped, which on that view reloaded the same
   * page — the second half of "the button is not working".
   */
  it('keeps the button on every view, and it opens the drawer rather than the same page', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    listLedgerRows.mockResolvedValue(unplaced);
    await renderPage({ view: 'no-account' });
    const banner = screen.getByRole('status');
    expect(within(banner).getByRole('link', { name: 'שיוך לחשבון' }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&view=no-account&act=attribute');
  });

  it('the drawer lists every unplaced movement in scope with its own control, whatever the view', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    listLedgerRows.mockResolvedValue([...unplaced, row({ id: '3', description: 'השכרת משאית' })]);
    // The נכנס view shows only one of the two unplaced rows; the drawer shows both.
    await renderPage({ view: 'in', act: 'attribute' });
    const drawer = screen.getByRole('dialog', { name: 'שיוך לחשבון' });
    expect(within(drawer).getByText('2 תנועות ממתינות לשיוך')).toBeTruthy();
    const list = within(drawer).getByRole('list', { name: 'תנועות בלי חשבון' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('combobox', { name: 'שיוך תרומה לחשבון' })).toBeTruthy();
    expect(within(list).getByRole('combobox', { name: 'שיוך מים וקרח לחשבון' })).toBeTruthy();
    expect(within(list).queryByText('השכרת משאית')).toBeNull();
    expect(within(drawer).getByRole('link', { name: 'סגירה' }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&view=in');
  });

  it('says so when the drawer is open and nothing is left to place', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    listLedgerRows.mockResolvedValue([row({ id: '1' })]);
    await renderPage({ act: 'attribute' });
    const drawer = screen.getByRole('dialog', { name: 'שיוך לחשבון' });
    expect(within(drawer).getByText(/אין תנועות שממתינות לשיוך/)).toBeTruthy();
    expect(within(drawer).queryByRole('combobox')).toBeNull();
  });

  it('offers no such control on a row that already names its account', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    listLedgerRows.mockResolvedValue([row({ id: '1', description: 'מים וקרח' })]);
    await renderPage();
    expect(screen.queryByRole('combobox', { name: /שיוך/ })).toBeNull();
  });

  it('says nothing at all when every movement names its account', async () => {
    listLedgerRows.mockResolvedValue([row({ id: '1' })]);
    await renderPage();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

/**
 * A19: a create drawer has no record to peek at, so it is `?act=<verb>` with
 * no `peek`, built through the kit's `openActHref`. This plan's `?new=movement`
 * predates that ruling.
 */
describe('recording a movement by hand', () => {
  it('offers תנועה חדשה in the page head, keeping the season', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: 'תנועה חדשה' }).getAttribute('href'))
      .toBe('/money/ledger?season=s1&act=movement');
  });

  it('opens the form from the URL', async () => {
    listAccounts.mockResolvedValue([{ id: 'a1', name: 'קופה מזומן', kind: 'cash' }]);
    await renderPage({ act: 'movement' });
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('button', { name: 'רישום התנועה' })).toBeTruthy();
    expect(within(drawer).getByRole('radio', { name: 'נכנס' })).toBeTruthy();
  });

  it('shows no drawer when the URL asks for none', async () => {
    await renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * Both are out of scope and neither is rendered disabled. The spec's
   * out-of-scope list names transfers explicitly, and no requirement in D7
   * asks for an export — a button that does nothing is worse than an absent
   * one, because it promises.
   */
  it('offers neither a transfer nor an export', async () => {
    await renderPage();
    expect(screen.queryByText('העברה בין חשבונות')).toBeNull();
    expect(screen.queryByText('ייצוא')).toBeNull();
  });
});
