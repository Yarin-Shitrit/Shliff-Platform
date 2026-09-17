import { describe, it, expect, beforeEach } from 'vitest';
import type { TestDb } from '@/test/db';
import { createTestDb } from '@/test/db';
import { seedCampBaseline } from '@/lib/seed/camp-seed';
import { getSeasonByName } from '@/lib/members/roster';
import { accountBalances } from './accounts';
import { ledgerTotals, listMovements, recordEntry } from './ledger';
import { budgetTotalAgorot } from './budget';
import {
  fundingTotalAgorot, ticketTotalAgorot, duesFundingIdentity, campBudgetFundingAgorot,
} from './funding';
import { listObligations, unnamedObligations } from './obligations';

const LEAD = 'lead@example.com';
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await seedCampBaseline(db, LEAD);
});

/**
 * The workbooks contain their own proofs. Each of these is an identity that
 * holds in the camp's own sheets, reproduced from database rows. They exist so
 * that a change which quietly breaks one of the camp's real totals fails here
 * rather than in front of a lead.
 *
 * Three of them no longer close from the seed alone, and their expected values
 * changed rather than being removed. The seed stopped transcribing the ledger
 * and the ברן 26 camp budget when the promoter took ownership of them, and a
 * test on `createTestDb()` cannot promote anything: PGlite holds no uploads,
 * no sheets and no blocks, so there is nothing to confirm. Those three
 * identities are verified after promotion instead, in the cutover script's
 * scratch run against a clone of live, and the figures they used to assert are
 * kept here in the comments so the change is a re-pointing and not a loss.
 */
describe('the workbooks own arithmetic', () => {
  /**
   * Was 62,000 in / 45,271 out / 16,729 net. Block
   * `6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f` produces those twelve movements
   * now. Zero here is the assertion that the seed does not ALSO produce them:
   * nothing deduplicates a seeded row against a promoted one, so a regression
   * that put them back would double the season in front of a lead.
   */
  it('ברן 26 ledger: nothing seeded — block 6f1a7fc4 owns all twelve', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.count).toBe(0);
    expect(totals.inAgorot).toBe(0);
    expect(totals.outAgorot).toBe(0);
    expect(totals.netAgorot).toBe(0);
  });

  /** Was 64,375.30, from twenty-four seeded `camp` lines. Block
   *  `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92` owns them now. */
  it('ברן 26 budget: nothing seeded — block 66ad3b61 owns all twenty-four', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await budgetTotalAgorot(db, s26.id)).toBe(0);
  });

  it('ברן 26 fundraising plan: 135,375.30', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await fundingTotalAgorot(db, s26.id)).toBe(13537530);
  });

  it('ברן 26 ticket projection: 171,000', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await ticketTotalAgorot(db, s26.id)).toBe(17100000);
  });

  /**
   * Was: 1,200 + 639.29 = 1,839.29, and `closes` true.
   *
   * The funding half is untouched — `funding_targets` has no archetype in
   * `BLOCK_ARCHETYPES`, so the seed still owns all eight targets — and both of
   * its figures are still pinned here. The full per-head figure was the camp
   * budget divided by 35, and the camp budget is the promoter's, so it reads 0
   * and the identity does not close. That asymmetry is the assertion: if the
   * fundraising plan had been dropped along with the budget, 22,375.30 and
   * 639.29 would go to 0 too and this test would fail.
   */
  it('the dues/fundraising identity keeps its funding half: 1,200 + 639.29', async () => {
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    // Pinned directly, not only through the rounded per-head figure below —
    // the identity divides this by 35 before comparing, so a drift of a few
    // agorot in the seeded dues line would round away and pass unnoticed.
    expect(await campBudgetFundingAgorot(db, s26.id)).toBe(2237530);

    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.flatRateAgorot).toBe(120000);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.perPersonFullAgorot).toBe(0);
    expect(identity.closes).toBe(false);
  });

  it('חוב יוסף: 15,240 − 14,330 = 910', async () => {
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const yosef = rows.find((row) => row.description.includes('יוסף'))!;
    expect(yosef.amountAgorot).toBe(1524000);
    expect(yosef.settledAgorot).toBe(1433000);
    expect(yosef.outstandingAgorot).toBe(91000);
  });

  it('the twelve reimbursements sum to 5,954, the surprises budget line', async () => {
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const reimbursements = rows.filter((row) => row.description !== 'חוב יוסף');
    expect(reimbursements).toHaveLength(12);
    expect(reimbursements.reduce((n, r) => n + r.amountAgorot, 0)).toBe(595400);

    // Length + sum alone would still miss a mutation that moves value between
    // two existing rows (drop 10 from one, add 10 to another) — count and
    // total both survive that untouched. Pinning the sorted multiset of
    // amounts closes that gap without hardcoding which name owns which figure.
    expect(reimbursements.map((r) => r.amountAgorot).sort((a, b) => a - b)).toEqual(
      [4000, 6500, 20000, 30000, 33500, 40000, 40000, 50000, 58000, 70900, 82000, 160500],
    );
  });

  it('two of them can never be closed, because nobody knows who is owed', async () => {
    const unnamed = await unnamedObligations(db);
    expect(unnamed).toHaveLength(2);
    expect(unnamed.every((row) => row.displayParty === null)).toBe(true);
  });

  /**
   * The workbook's ברן 25 sheet nets to 44,183.55 — but only because its
   * income column includes `מעבר לקובץ חדש 44,647`, the previous book's
   * closing balance. Under a continuous ledger that row is not income, so the
   * season nets to −463.45 and the 44,647 lives as an opening balance.
   *
   * This used to assert 50,306.55 in / 50,770 out / −463.45 net from seven
   * seeded rows, and then reconcile that net against the מיקום block. Block
   * `ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6` produces the seven now, and refuses
   * the carry-forward row on its own rule (`carry-forward`), so the judgement
   * survives the seed losing it.
   *
   * What is still checkable here is the other side of the same identity, and
   * it is kept whole: the מיקום openings must come to exactly 44,647 − 463.45.
   * `accountBalances` is a separate query over opening balances only, so a
   * drift in any of the three still fails this, and the −463.45 the promoter
   * has to produce stays written down rather than becoming folklore. The two
   * halves actually meet in the cutover's scratch run, which promotes the
   * block into a clone that holds these same openings.
   */
  it('ברן 25: the מיקום openings reconcile to −463.45 plus the 44,647 carry-forward', async () => {
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const totals = await ledgerTotals(db, { seasonId: s25.id });
    expect(totals.count).toBe(0);
    expect(totals.netAgorot).toBe(0);

    const mikomTotalAgorot = (await accountBalances(db))
      .reduce((n, row) => n + row.balanceAgorot, 0);
    expect(mikomTotalAgorot - 4464700).toBe(-46345);
  });

  /**
   * ברן 25's four רחבה deliverables are its only recorded budget lines —
   * 41,300 + 12,950 + 30,810 + 4,000 = 89,060, category `dancefloor` — and it
   * has no `camp` line at all. The identity must report that as no camp
   * budget recorded, not as the dancefloor total divided by the camp.
   */
  it('ברן 25 has a dancefloor budget but no camp budget, and the identity says so', async () => {
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    expect(await budgetTotalAgorot(db, s25.id, 'dancefloor')).toBe(8906000);
    expect(await budgetTotalAgorot(db, s25.id, 'camp')).toBe(0);

    const identity = await duesFundingIdentity(db, s25.id);
    expect(identity.budgetTotalAgorot).toBe(0);
    expect(identity.perPersonFullAgorot).toBe(0);
    expect(identity.closes).toBe(false);
  });

  it('the מיקום block reproduces: 1,584 + 28,520 + 14,079.55 = 44,183.55', async () => {
    const balances = await accountBalances(db);
    const byName = new Map(balances.map((row) => [row.name, row.balanceAgorot]));
    expect(byName.get('קופת מזומן')).toBe(158400);
    expect(byName.get('וייבז קלוז פרינדס')).toBe(2852000);
    expect(byName.get('עו״ש אופק')).toBe(1407955);
    expect(balances.reduce((n, row) => n + row.balanceAgorot, 0)).toBe(4418355);
  });

  it('derives a balance rather than storing one', async () => {
    const balances = await accountBalances(db);
    const kupa = balances.find((row) => row.name === 'קופת מזומן')!;

    await recordEntry(db, {
      occurredOn: new Date('2026-09-01T00:00:00Z'), direction: 'out', amount: 84,
      description: 'בדיקה', accountId: kupa.accountId, recordedBy: LEAD,
    });

    const after = (await accountBalances(db))
      .find((row) => row.name === 'קופת מזומן')!;
    expect(after.balanceAgorot).toBe(kupa.balanceAgorot - 8400);

    // and the movement is visible in the ledger, not swallowed by a stored total
    const moves = await listMovements(db, { accountId: kupa.accountId });
    expect(moves.some((m) => m.description === 'בדיקה')).toBe(true);
  });
});
