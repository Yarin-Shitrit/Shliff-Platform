/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { SeasonMoneySummary } from '@/lib/money/summary';
import type { DuesFundingIdentity } from '@/lib/money/funding';
import type { ObligationRow } from '@/lib/money/obligations';
import type { BudgetLineRow, DerivationRow } from '@/lib/money/budget';
import type { Movement } from '@/lib/money/ledger';

/**
 * `vi.mock` factories are hoisted above every other statement, so a plain
 * top-level `const` referenced inside one throws "Cannot access before
 * initialization" — `vi.hoisted` gives the factories something to close
 * over instead (see `src/lib/auth/guard.test.ts`).
 */
const {
  requireAdmin, listSeasons, seasonMoneySummary, listMovements,
  listBudgetLines, budgetDerivation,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listSeasons: vi.fn(),
  seasonMoneySummary: vi.fn(),
  listMovements: vi.fn(),
  listBudgetLines: vi.fn(),
  budgetDerivation: vi.fn(),
}));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin }));
vi.mock('@/lib/members/roster', () => ({ listSeasons }));
vi.mock('@/lib/money/summary', () => ({ seasonMoneySummary }));
vi.mock('@/lib/money/ledger', () => ({ listMovements }));
vi.mock('@/lib/money/budget', () => ({ listBudgetLines, budgetDerivation }));

import MoneyPage from './page';
import styles from './money.module.css';

const SEASON = { id: 's1', name: 'ברן 26', year: 2026, flatRate: '1200.00', plannedSize: 35, startsOn: null };

/** The identity's own real fixture (see `src/lib/money/funding.test.ts`):
 *  the budget for ברן 26 is 64,375.30 for 35 people, 1,839.29 each; dues are
 *  1,200 and fundraising's 22,375.30 target covers the 639.29 difference. */
function identity(overrides: Partial<DuesFundingIdentity> = {}): DuesFundingIdentity {
  return {
    seasonId: 's1',
    budgetTotalAgorot: 6437530,
    plannedSize: 35,
    flatRateAgorot: 120000,
    duesCoverAgorot: 4200000,
    fundingTargetAgorot: 2237530,
    perPersonFullAgorot: 183929,
    perPersonFundingAgorot: 63929,
    closes: true,
    ...overrides,
  };
}

function summary(overrides: Partial<SeasonMoneySummary> = {}): SeasonMoneySummary {
  return {
    seasonId: 's1',
    seasonName: 'ברן 26',
    accounts: [],
    totalBalanceAgorot: 500000,
    unattributed: { paymentsAgorot: 0, entriesAgorot: 0 },
    ledger: { inAgorot: 100000, outAgorot: 50000, netAgorot: 50000, count: 3 },
    identity: identity(),
    campOwes: [],
    owedToCamp: [],
    campOwesAgorot: 0,
    owedToCampAgorot: 0,
    unnamed: [],
    ...overrides,
  };
}

function sectionFor(headingText: string): HTMLElement {
  const section = screen.getByRole('heading', { name: headingText }).closest('section');
  if (!section) throw new Error(`no <section> ancestor for heading "${headingText}"`);
  return section as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  listSeasons.mockResolvedValue([SEASON]);
  seasonMoneySummary.mockResolvedValue(summary());
  listMovements.mockResolvedValue([]);
  listBudgetLines.mockResolvedValue([]);
  budgetDerivation.mockResolvedValue([]);
  requireAdmin.mockResolvedValue({ ok: true, email: 'lead@shliff.camp' });
});

describe('MoneyPage', () => {
  it('enforces the admin gate before touching the database', async () => {
    requireAdmin.mockResolvedValue({ ok: false });
    await expect(MoneyPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    // UI hiding is never the enforcement — the gate must short-circuit before
    // any query runs, not merely omit a section of an otherwise-fetched page.
    expect(listSeasons).not.toHaveBeenCalled();
  });

  it('invites the lead to seed data instead of a bare page when there are no seasons', async () => {
    listSeasons.mockResolvedValue([]);
    render(await MoneyPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('עדיין אין שנים. הריצו את הזריעה מדף הייבוא.')).toBeTruthy();
    expect(seasonMoneySummary).not.toHaveBeenCalled();
  });

  it('leads with the hero figure and the thesis sentence, all four numbers', async () => {
    const { container } = render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const hero = container.querySelector(`.${styles.hero}`);
    const thesis = container.querySelector(`.${styles.thesis}`);
    expect(hero?.textContent).toContain('1,200');
    expect(thesis?.textContent).toContain('64,375.30');
    expect(thesis?.textContent).toContain('35');
    expect(thesis?.textContent).toContain('1,839.29');
    expect(thesis?.textContent).toContain('639.29');
  });

  it('omits both mismatch warnings when the identity closes cleanly', async () => {
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.queryByText(/לא מסתכמים לתקציב/)).toBeNull();
    expect(screen.queryByText(/אי אפשר לחשב עלות לאדם/)).toBeNull();
  });

  it("shows the mismatch warning, not the can't-compute one, when dues+funding miss the budget", async () => {
    seasonMoneySummary.mockResolvedValue(summary({ identity: identity({ closes: false }) }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.getByText(/לא מסתכמים לתקציב/)).toBeTruthy();
    expect(screen.queryByText(/אי אפשר לחשב עלות לאדם/)).toBeNull();
  });

  it('shows the can\'t-compute message, not the mismatch warning, when there is no planned size', async () => {
    seasonMoneySummary.mockResolvedValue(summary({
      identity: identity({
        plannedSize: null, duesCoverAgorot: null,
        perPersonFullAgorot: null, perPersonFundingAgorot: null, closes: false,
      }),
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.getByText(/אי אפשר לחשב עלות לאדם בלי גודל מחנה מתוכנן/)).toBeTruthy();
    // `closes` is also false here (duesFundingIdentity's own contract), but
    // that false means "no size to check", not "the halves disagree" — the
    // page must tell those two apart rather than reusing one warning for both.
    expect(screen.queryByText(/לא מסתכמים לתקציב/)).toBeNull();
  });

  it('flags money with no account named, without folding it into an account', async () => {
    seasonMoneySummary.mockResolvedValue(summary({
      unattributed: { paymentsAgorot: 20000, entriesAgorot: 15000 },
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    const section = sectionFor('איפה הכסף');
    expect(within(section).getByText(/350/)).toBeTruthy();
    expect(within(section).getByText(/נרשמו בלי לציין לאיזה חשבון נכנסו/)).toBeTruthy();
  });

  it('says nothing about unattributed money when every shekel is placed', async () => {
    // The zero case is not "no news" — a `>= 0` off-by-one here would show
    // the same warning for every season, training the lead to ignore it.
    seasonMoneySummary.mockResolvedValue(summary({
      unattributed: { paymentsAgorot: 0, entriesAgorot: 0 },
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.queryByText(/נרשמו בלי לציין לאיזה חשבון נכנסו/)).toBeNull();
  });

  it('shows an unnamed obligation\'s warning glyph inline, and the un-settleable count separately', async () => {
    const named: ObligationRow = {
      id: 'o1', direction: 'camp_owes', partyPersonId: 'p1', partyName: null,
      displayParty: 'אופק', description: 'שכ״ט DJ', amountAgorot: 200000,
      settledAgorot: 0, outstandingAgorot: 200000, settled: false, unnamed: false,
      seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    };
    const unnamed: ObligationRow = {
      id: 'o2', direction: 'camp_owes', partyPersonId: null, partyName: null,
      displayParty: null, description: 'הובלה', amountAgorot: 50000,
      settledAgorot: 0, outstandingAgorot: 50000, settled: false, unnamed: true,
      seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    };
    seasonMoneySummary.mockResolvedValue(summary({
      campOwes: [named, unnamed], owedToCamp: [], campOwesAgorot: 250000,
      unnamed: [unnamed],
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const section = sectionFor('מה חייבים ומה חייבים לנו');
    const rows = within(section).getAllByRole('row');
    // rows[0] is the header; the two data rows follow in array order.
    expect(within(rows[1]).getByText('אופק')).toBeTruthy();
    expect(within(rows[1]).queryByText('⚠ חסר שם')).toBeNull();
    expect(within(rows[2]).getByText('⚠ חסר שם')).toBeTruthy();

    // The un-settleable count is a fact about `summary.unnamed` (one row),
    // independent of how many obligation rows the table happens to show
    // (two) — a mutation that counted table rows instead would read "2".
    // `getByText` only inspects an element's own direct text-node children
    // (see `getNodeText` in @testing-library/dom), so a phrase split across
    // a `<bdi>` needs a plain substring check on `textContent` instead.
    expect(section.textContent).toMatch(/⚠ 1 חובות בלי שם/);
  });

  it("flags a budget line's bad arithmetic inline, without hiding its total", async () => {
    const off: BudgetLineRow = {
      id: 'b1', label: 'קבוצה א', quantityText: '10', quantityNumAgorot: 1000,
      unitCostAgorot: 5000, totalAgorot: 40000, rationale: null, category: 'camp',
      arithmeticOff: true,
    };
    const ok: BudgetLineRow = {
      id: 'b2', label: 'קבוצה ב', quantityText: '2', quantityNumAgorot: 200,
      unitCostAgorot: 3000, totalAgorot: 6000, rationale: null, category: 'camp',
      arithmeticOff: false,
    };
    listBudgetLines.mockResolvedValue([off, ok]);
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const section = sectionFor('התקציב');
    const rows = within(section).getAllByRole('row');
    expect(within(rows[1]).getByText('⚠')).toBeTruthy();
    expect(within(rows[1]).getByText(/400/)).toBeTruthy();
    expect(within(rows[2]).queryByText('⚠')).toBeNull();
    expect(within(rows[2]).getByText(/60\b/)).toBeTruthy();
  });

  it('renders new-this-season and dropped-from-budget derivation rows distinctly, never as zero', async () => {
    listSeasons.mockResolvedValue([
      { ...SEASON, id: 's2', name: 'ברן 27', year: 2027 },
      SEASON,
    ]);
    const newThisSeason: DerivationRow = {
      label: 'סעיף חדש לגמרי', actualAgorot: null, forecastAgorot: 500000,
      bufferAgorot: null, rationale: '',
    };
    const droppedFromBudget: DerivationRow = {
      label: 'סעיף שירד', actualAgorot: 300000, forecastAgorot: null,
      bufferAgorot: -300000, rationale: 'לא נכלל בתקציב הבא',
    };
    budgetDerivation.mockResolvedValue([newThisSeason, droppedFromBudget]);

    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's2' }) }));

    const section = sectionFor('מאיפה התקציב הזה בא');
    const rows = within(section).getAllByRole('row');
    // Each of these two positive assertions is itself the "never zero, never
    // blank" guarantee: a mutant that defaulted a null actual/forecast to 0
    // and formatted it would render "0 ₪" in place of the label span below,
    // so that span would stop being found — there is no separate value to
    // check `!== 0` against once the label itself is confirmed present.
    expect(within(rows[1]).getByText('סעיף חדש')).toBeTruthy();
    expect(within(rows[1]).getByText(/5,000/)).toBeTruthy();
    expect(within(rows[2]).getByText('ירד מהתקציב')).toBeTruthy();
    // Scoped to the "actual" cell specifically: the row's buffer cell also
    // contains "3,000" (as "-3,000", the negative buffer for a dropped
    // line), so an unscoped match on the row would pass on either cell and
    // stop discriminating which one actually holds the actual-spend figure.
    const actualCell = within(rows[2]).getAllByRole('cell')[1];
    expect(within(actualCell).getByText(/3,000/)).toBeTruthy();
  });

  it('omits the derivation section entirely when there is no previous season to derive from', async () => {
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.queryByText('מאיפה התקציב הזה בא')).toBeNull();
    expect(budgetDerivation).not.toHaveBeenCalled();
  });

  it('invites action instead of bare empty tables for a season with no movements, budget, or obligations', async () => {
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.getByText(/עדיין אין תנועות ל/)).toBeTruthy();
    expect(screen.getByText(/עדיין לא נרשם תקציב ל/)).toBeTruthy();
    expect(screen.getByText('אין חובות רשומים לשנה הזו.')).toBeTruthy();
    expect(screen.getByText('עדיין לא נרשמו חשבונות.')).toBeTruthy();
    // A `>= 0` off-by-one on the unnamed-count guard would show this banner
    // on every season, including one with nothing unnamed to chase down.
    expect(screen.queryByText(/חובות בלי שם/)).toBeNull();
  });

  it("moves a movement's amount into the in/out column that matches its direction", async () => {
    const moves: Movement[] = [
      {
        id: 'm1', source: 'ledger', occurredOn: new Date('2026-01-05'), direction: 'in',
        amountAgorot: 70000, description: 'תרומה', accountId: 'a1', accountName: 'קופה',
        seasonId: 's1', eventId: null,
      },
      {
        id: 'm2', source: 'ledger', occurredOn: new Date('2026-01-06'), direction: 'out',
        amountAgorot: 30000, description: 'ציוד', accountId: null, accountName: null,
        seasonId: 's1', eventId: null,
      },
    ];
    listMovements.mockResolvedValue(moves);
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const section = sectionFor('התנועות');
    const rows = within(section).getAllByRole('row');
    const [, inRow, outRow] = rows;
    // Columns are תאריך(0) תיאור(1) חשבון(2) נכנס(3) יצא(4). Checking the
    // whole row for "700" would also pass if the amount landed in the יצא
    // column instead of נכנס — the two columns are siblings in the same row,
    // so the assertion has to name the cell, not just the row.
    const inCells = within(inRow).getAllByRole('cell');
    const outCells = within(outRow).getAllByRole('cell');
    expect(within(inCells[3]).getByText(/700/)).toBeTruthy();
    expect(within(inCells[4]).queryByText(/700/)).toBeNull();
    expect(within(outCells[4]).getByText(/300/)).toBeTruthy();
    expect(within(outCells[3]).queryByText(/300/)).toBeNull();
    // No account named on the second movement — shown as its own admission,
    // not folded into a guessed account.
    expect(within(outRow).getByText('לא צוין')).toBeTruthy();
  });
});
