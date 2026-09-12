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
    unattributed: { inAgorot: 0, outAgorot: 0, paymentsAgorot: 0 },
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
    const message = screen.getByText(/בלי גודל מחנה מתוכנן/);
    // Names the season and points at the season switcher, same as every
    // other "nothing here" message on this page — this one was found only
    // by sweeping the file for the pattern after finding it twice elsewhere,
    // so its own regression needs its own test rather than riding along on
    // the assertion above, which would still pass against the bare original
    // wording ("...לשנה הזו." with no season name and no next step).
    expect(message.textContent).toContain(SEASON.name);
    expect(message.textContent).toContain('אם חיפשתם שנה אחרת');
    // `closes` is also false here (duesFundingIdentity's own contract), but
    // that false means "no size to check", not "the halves disagree" — the
    // page must tell those two apart rather than reusing one warning for both.
    expect(screen.queryByText(/לא מסתכמים לתקציב/)).toBeNull();
  });

  it('never draws a "דמי קאמפ" segment as a lying zero when there is a budget and a funding target but no planned camp size', async () => {
    seasonMoneySummary.mockResolvedValue(summary({
      identity: identity({
        budgetTotalAgorot: 7000000, fundingTargetAgorot: 1500000,
        plannedSize: null, duesCoverAgorot: null,
        perPersonFullAgorot: null, perPersonFundingAgorot: null, closes: false,
      }),
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    // "דמי קאמפ" is the StackedBar segment's own label and appears nowhere
    // else on this page (Nav, which also uses that label, is not part of
    // this render) — its total absence is what proves the bar itself was
    // never drawn, as opposed to drawn with a zero-length, misleading segment.
    expect(screen.queryByText('דמי קאמפ')).toBeNull();
    expect(screen.getByText(/בלי גודל מחנה מתוכנן/)).toBeTruthy();
  });

  it('flags unattributed inflow — ledger and dues payments combined — without folding it into an account', async () => {
    seasonMoneySummary.mockResolvedValue(summary({
      unattributed: { inAgorot: 15000, outAgorot: 0, paymentsAgorot: 20000 },
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    const section = sectionFor('איפה הכסף');
    expect(within(section).getByText(/350/)).toBeTruthy();
    expect(within(section).getByText(/נרשמו בלי לציין לאיזה חשבון נכנסו/)).toBeTruthy();
    // Money in and money out are different facts — an outflow sentence here
    // would mean the two got summed again, just under a different label.
    expect(within(section).queryByText(/יצאו/)).toBeNull();
  });

  it('flags unattributed outflow separately from inflow, with its own sentence', async () => {
    seasonMoneySummary.mockResolvedValue(summary({
      unattributed: { inAgorot: 0, outAgorot: 30000, paymentsAgorot: 0 },
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    const section = sectionFor('איפה הכסף');
    expect(within(section).getByText(/300/)).toBeTruthy();
    expect(within(section).getByText(/נרשמו בלי לציין מאיזה חשבון יצאו/)).toBeTruthy();
    expect(within(section).queryByText(/נכנסו/)).toBeNull();
  });

  it('says nothing about unattributed money when every shekel is placed', async () => {
    // The zero case is not "no news" — a `>= 0` off-by-one here would show
    // the same warning for every season, training the lead to ignore it.
    seasonMoneySummary.mockResolvedValue(summary({
      unattributed: { inAgorot: 0, outAgorot: 0, paymentsAgorot: 0 },
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));
    expect(screen.queryByText(/נרשמו בלי לציין לאיזה חשבון נכנסו/)).toBeNull();
    expect(screen.queryByText(/נרשמו בלי לציין מאיזה חשבון יצאו/)).toBeNull();
  });

  /**
   * ברן 25 has only its dancefloor budget lines recorded — no `camp` line —
   * so `duesFundingIdentity` reports `budgetTotalAgorot: 0` honestly. The
   * page must not present that 0 as a real per-head cost (the thesis would
   * print "0 ₪ לאדם"), and must not reuse the "no planned size" message,
   * since this season's planned size (35, from `identity()`'s default) is
   * known — what's missing is the budget itself.
   */
  it('reports the camp budget as not recorded yet, not as a lying zero, when the season has no camp-category budget lines', async () => {
    seasonMoneySummary.mockResolvedValue(summary({
      identity: identity({
        budgetTotalAgorot: 0, perPersonFullAgorot: 0, perPersonFundingAgorot: 0, closes: false,
      }),
    }));
    const { container } = render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const message = screen.getByText(/עדיין לא נרשם תקציב קאמפ/);
    expect(message.textContent).toContain(SEASON.name);
    expect(screen.queryByText(/בלי גודל מחנה מתוכנן/)).toBeNull();
    expect(container.querySelector(`.${styles.thesis}`)).toBeNull();
    expect(screen.queryByText(/לא מסתכמים לתקציב/)).toBeNull();
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

    // Each empty state must name the season *and* point somewhere actionable
    // — the season switcher above is not enough on its own, because these
    // three tables are only ever populated through /upload; a message that
    // just states absence (as the earlier version of this page did) leaves a
    // lead who just seeded a season with no idea what to do next.
    for (const heading of ['התנועות', 'התקציב', 'מה חייבים ומה חייבים לנו']) {
      const section = sectionFor(heading);
      expect(within(section).getByText(SEASON.name)).toBeTruthy();
      const link = within(section).getByRole('link', { name: 'דף הייבוא' });
      expect(link.getAttribute('href')).toBe('/upload');
    }

    // Accounts are camp-wide, not season-scoped (see `accountBalances` in
    // src/lib/money/accounts.ts) — pointing at "the season switcher above"
    // for an empty account list would be actively misleading, since
    // switching seasons can never change it. BarList's `emptyMessage` prop is
    // a plain string, so this one is text-only, not a real link.
    const accountsSection = sectionFor('איפה הכסף');
    expect(within(accountsSection).getByText(/דף הייבוא/)).toBeTruthy();

    // A `>= 0` off-by-one on the unnamed-count guard would show this banner
    // on every season, including one with nothing unnamed to chase down.
    expect(screen.queryByText(/חובות בלי שם/)).toBeNull();
  });

  it("splits camp-owes and owed-to-camp into two separately headed tables, so a reader is never left to infer direction from row order", async () => {
    const weOweRow: ObligationRow = {
      id: 'o1', direction: 'camp_owes', partyPersonId: null, partyName: 'דנה',
      displayParty: 'דנה', description: 'תיקון גנרטור', amountAgorot: 80000,
      settledAgorot: 0, outstandingAgorot: 80000, settled: false, unnamed: false,
      seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    };
    const owedToUsRow: ObligationRow = {
      id: 'o2', direction: 'owed_to_camp', partyPersonId: null, partyName: 'יוסי',
      displayParty: 'יוסי', description: 'מקדמה על אוהל', amountAgorot: 45000,
      settledAgorot: 0, outstandingAgorot: 45000, settled: false, unnamed: false,
      seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    };
    seasonMoneySummary.mockResolvedValue(summary({
      campOwes: [weOweRow], owedToCamp: [owedToUsRow],
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    // Scoped to each subheading's own table (its next sibling) — a search
    // anywhere in the outer section would find both names regardless of
    // which table they actually landed in, and would not prove a reader can
    // tell the two directions apart.
    const weOweTable = screen.getByRole('heading', { name: 'מה אנחנו חייבים' })
      .nextElementSibling as HTMLElement;
    const owedToUsTable = screen.getByRole('heading', { name: 'מה חייבים לנו' })
      .nextElementSibling as HTMLElement;

    expect(within(weOweTable).getByText('דנה')).toBeTruthy();
    expect(within(weOweTable).queryByText('יוסי')).toBeNull();
    expect(within(owedToUsTable).getByText('יוסי')).toBeTruthy();
    expect(within(owedToUsTable).queryByText('דנה')).toBeNull();
  });

  /**
   * A season with debt in only one direction is the ordinary case for this
   * camp, not an edge case — ברן 25's reimbursements mean the camp owes
   * several people while nobody owed the camp anything that season. Splitting
   * the table into two independent JSX literals (one per direction) means a
   * fix applied to one message does not guarantee the other got it too —
   * that is exactly how the first version of this split shipped with two
   * fresh copies of the very defect finding 1 had just removed elsewhere on
   * this page. Both directions are tested here, separately, for that reason:
   * a test that only ever emptied `owedToCamp` (or only ever emptied
   * `campOwes`) could not have caught the sibling that was still broken.
   */
  it('instructs rather than merely reports when only "מה אנחנו חייבים" is empty', async () => {
    const owedToUsRow: ObligationRow = {
      id: 'o2', direction: 'owed_to_camp', partyPersonId: null, partyName: 'יוסי',
      displayParty: 'יוסי', description: 'מקדמה על אוהל', amountAgorot: 45000,
      settledAgorot: 0, outstandingAgorot: 45000, settled: false, unnamed: false,
      seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    };
    seasonMoneySummary.mockResolvedValue(summary({
      campOwes: [], owedToCamp: [owedToUsRow],
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const emptyDirection = screen.getByRole('heading', { name: 'מה אנחנו חייבים' })
      .nextElementSibling as HTMLElement;
    expect(within(emptyDirection).getByText(SEASON.name)).toBeTruthy();
    const link = within(emptyDirection).getByRole('link', { name: 'דף הייבוא' });
    expect(link.getAttribute('href')).toBe('/upload');

    const populatedDirection = screen.getByRole('heading', { name: 'מה חייבים לנו' })
      .nextElementSibling as HTMLElement;
    expect(within(populatedDirection).getByText('יוסי')).toBeTruthy();
  });

  it('instructs rather than merely reports when only "מה חייבים לנו" is empty', async () => {
    const weOweRow: ObligationRow = {
      id: 'o1', direction: 'camp_owes', partyPersonId: null, partyName: 'דנה',
      displayParty: 'דנה', description: 'תיקון גנרטור', amountAgorot: 80000,
      settledAgorot: 0, outstandingAgorot: 80000, settled: false, unnamed: false,
      seasonId: 's1', sourceBlockId: null, sourceRow: null, settlements: [],
    };
    seasonMoneySummary.mockResolvedValue(summary({
      campOwes: [weOweRow], owedToCamp: [],
    }));
    render(await MoneyPage({ searchParams: Promise.resolve({ season: 's1' }) }));

    const populatedDirection = screen.getByRole('heading', { name: 'מה אנחנו חייבים' })
      .nextElementSibling as HTMLElement;
    expect(within(populatedDirection).getByText('דנה')).toBeTruthy();

    const emptyDirection = screen.getByRole('heading', { name: 'מה חייבים לנו' })
      .nextElementSibling as HTMLElement;
    expect(within(emptyDirection).getByText(SEASON.name)).toBeTruthy();
    const link = within(emptyDirection).getByRole('link', { name: 'דף הייבוא' });
    expect(link.getAttribute('href')).toBe('/upload');
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
