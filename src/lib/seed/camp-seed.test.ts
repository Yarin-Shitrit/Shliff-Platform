import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { getSeasonByName, listRoster } from '@/lib/members/roster';
import { resolveName, listUnlinkedNames } from '@/lib/members/identity';
import { listDues } from '@/lib/fees/dues';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { listEvents } from '@/lib/work/events';
import { responsibilitiesOf } from '@/lib/work/coverage';
import { personDossier } from '@/lib/members/dossier';
import { seedCampBaseline } from '@/lib/seed/camp-seed';

const LEAD = 'lead@shliff.camp';

describe('seedCampBaseline', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('seeds the two seasons whose rates the workbooks state', async () => {
    await seedCampBaseline(db, LEAD);
    const s25 = await getSeasonByName(db, 'ברן 25');
    const s26 = await getSeasonByName(db, 'ברן 26');
    expect(s25?.flatRate).toBe('1500.00');
    expect(s25?.plannedSize).toBe(43);
    expect(s26?.flatRate).toBe('1200.00');
    expect(s26?.plannedSize).toBe(35);
    // ברן 23 and ברן 24 have no recorded rate — not invented.
    expect(await getSeasonByName(db, 'ברן 23')).toBeUndefined();
  });

  it('is idempotent', async () => {
    const first = await seedCampBaseline(db, LEAD);
    const second = await seedCampBaseline(db, LEAD);
    expect(second.seasons).toBe(0);
    expect(second.people).toBe(0);
    expect(second.tasks).toBe(0);
    expect(first.people).toBeGreaterThan(0);
  });

  it('queues ראנצ׳ו ונטלי instead of splitting or guessing', async () => {
    await seedCampBaseline(db, LEAD);
    const queue = await listUnlinkedNames(db);
    expect(queue.map((q) => q.alias)).toContain('ראנצ׳ו ונטלי');
    expect((await resolveName(db, 'ראנצ׳ו ונטלי')).personId).toBeNull();
  });

  it('keeps דניאל פינטו and דניאל ענבר as two people', async () => {
    await seedCampBaseline(db, LEAD);
    const pinto = await resolveName(db, 'דניאל פינטו');
    const inbar = await resolveName(db, 'דניאל ענבר');
    expect(pinto.personId).not.toBeNull();
    expect(inbar.personId).not.toBeNull();
    expect(pinto.personId).not.toBe(inbar.personId);
  });

  it('records the five ברן 25 exceptions with their amounts', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 25'))!;
    const rows = await listDues(db, season.id);
    const exceptions = rows.filter((r) => r.kind === 'exception');

    expect(exceptions).toHaveLength(5);
    const byName = new Map(exceptions.map((r) => [r.displayName, r.amountAgorot]));
    expect(byName.get('עזריאל')).toBe(100000);
    expect(byName.get('עדי')).toBe(100000);
    expect(byName.get('דניאל פינטו')).toBe(55500);
    expect(byName.get('דנה שרון')).toBe(140000);
    expect(byName.get('עמירם דהן')).toBe(0);
    // Every one carries a reason — that is the point.
    expect(exceptions.every((r) => (r.exceptionReason ?? '').length > 0)).toBe(true);
  });

  it('settles the five ברן 26 dues through one 6,000 offset', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 26'))!;
    const summary = await seasonFeeSummary(db, season.id);

    expect(summary.collectedAgorot).toBe(600000);
    expect(summary.memberCount).toBe(5);
    expect(summary.unpaidCount).toBe(0);

    const yosef = await resolveName(db, 'יוסף');
    const dossier = await personDossier(db, yosef.personId!);
    const due26 = dossier!.dues.find((d) => d.seasonName === 'ברן 26')!;
    expect(due26.settled).toBe(true);
  });

  it('gives אופק both of his ברן 25 deliverables', async () => {
    await seedCampBaseline(db, LEAD);
    const ofek = await resolveName(db, 'אופק');
    const owned = await responsibilitiesOf(db, ofek.personId!);

    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל']);
    expect(owned.find((r) => r.title === 'חשמל')?.budgetAgorot).toBe(1295000);
    expect(owned.find((r) => r.title === 'הובלה')?.budgetAgorot).toBe(400000);
  });

  it('seeds the fundraising events for both seasons', async () => {
    await seedCampBaseline(db, LEAD);
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    expect((await listEvents(db, s25.id)).map((e) => e.name))
      .toContain('Halloween Underground 311025');
    expect((await listEvents(db, s26.id)).map((e) => e.name))
      .toContain('מסיבת פקאנים');
  });

  it('puts only evidenced people on the ברן 25 roster', async () => {
    await seedCampBaseline(db, LEAD);
    const season = (await getSeasonByName(db, 'ברן 25'))!;
    const roster = await listRoster(db, season.id);
    // The 38 anonymous רגילים stay a count on the season, not invented rows.
    expect(roster.length).toBeLessThan(38);
    expect(roster.map((r) => r.displayName)).toContain('אופק');
  });

  it('seeds the three ברן 25 accounts, including the personal one', async () => {
    await seedCampBaseline(db, LEAD);
    const { accountBalances } = await import('@/lib/money/accounts');
    const balances = await accountBalances(db);
    const names = balances.map((row) => row.name);
    expect(names).toContain('קופת מזומן');
    expect(names).toContain('עו״ש אופק');
    expect(names).toContain('וייבז קלוז פרינדס');

    const ofek = balances.find((row) => row.name === 'עו״ש אופק')!;
    expect(ofek.kind).toBe('personal');
    expect(ofek.holderName).toBe('אופק');
  });

  /**
   * This used to assert ברן 25's bottom line — 50,306.55 in, 50,770 out,
   * −463.45 net — from seven hand-transcribed rows, and its stated purpose was
   * to catch the 44,647 `מעבר לקובץ חדש` carry-forward being seeded as income.
   *
   * The seed writes no ברן 25 ledger row at all now: block
   * `ac5a9d6e-8b52-40a9-bfea-a22771a2e4c6` (`סיכום כללי` of `קופת קאמפ 25’`)
   * produces all seven, and refuses the carry-forward row itself with reason
   * `carry-forward`. So the expected value is zero, and the gate it holds is
   * the stronger one: the seed must not put a ברן 25 movement back, by any
   * route, because a seeded row and a promoted row are not deduplicated
   * anywhere and the season would be counted twice.
   */
  it('writes no ברן 25 ledger movement — block ac5a9d6e owns all seven', async () => {
    await seedCampBaseline(db, LEAD);
    const { ledgerTotals } = await import('@/lib/money/ledger');
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const totals = await ledgerTotals(db, { seasonId: s25.id });
    expect(totals.count).toBe(0);
    expect(totals.outAgorot).toBe(0);
    expect(totals.inAgorot).toBe(0);
    expect(totals.netAgorot).toBe(0);
  });

  /**
   * Was 62,000 in / 45,271 out / 16,729 net, from twelve transcribed rows.
   * Block `6f1a7fc4-03ac-4ec3-abe4-0b5a863e133f` (`סיכום כללי` of
   * `קופת קאמפ 2026`) produces all twelve now. Kept season-scoped rather than
   * folded into the ברן 25 test above: each season has its own owning block,
   * and a regression that re-seeded only one of them must fail on its own.
   */
  it('writes no ברן 26 ledger movement — block 6f1a7fc4 owns all twelve', async () => {
    await seedCampBaseline(db, LEAD);
    const { ledgerTotals } = await import('@/lib/money/ledger');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.count).toBe(0);
    expect(totals.outAgorot).toBe(0);
    expect(totals.inAgorot).toBe(0);
    expect(totals.netAgorot).toBe(0);
  });

  /**
   * The twenty-four ברן 26 `camp` budget lines are block
   * `66ad3b61-8b6c-4852-90a4-1cfe0b1f8a92`'s now. Nothing else in this file
   * looks at ברן 26's budget lines directly — the identity test below sees the
   * total, but a seed that wrote the lines back under the wrong category would
   * leave that total at 0 and pass. This asserts the rows themselves.
   */
  it('writes no ברן 26 budget line — block 66ad3b61 owns all twenty-four', async () => {
    await seedCampBaseline(db, LEAD);
    const { listBudgetLines } = await import('@/lib/money/budget');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    expect(await listBudgetLines(db, s26.id)).toEqual([]);
  });

  /**
   * Was: budget 64,375.30, per head 1,839.29, and the identity closes.
   *
   * It cannot close from seeded rows any more, and that is the honest result
   * rather than a lowered gate: the identity's budget half is exactly what the
   * seed gave up. `campBudgetFundingAgorot` and `perPersonFundingAgorot` are
   * unchanged at 22,375.30 and 639.29 — `funding_targets` has no archetype, so
   * the seed still owns that half — which is what makes this test discriminate
   * between "the budget moved to the promoter" (expected) and "the fundraising
   * plan was dropped too" (a bug). The identity closing again is verified
   * after promotion, in the cutover's scratch run, not here.
   */
  it('cannot close the ברן 26 identity alone — the budget half is the promoter\'s', async () => {
    await seedCampBaseline(db, LEAD);
    const { duesFundingIdentity } = await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.budgetTotalAgorot).toBe(0);
    expect(identity.perPersonFullAgorot).toBe(0);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.flatRateAgorot).toBe(120000);
    expect(identity.closes).toBe(false);
  });

  it('seeds חוב יוסף with 910 outstanding', async () => {
    await seedCampBaseline(db, LEAD);
    const { listObligations } = await import('@/lib/money/obligations');
    const rows = await listObligations(db, { direction: 'camp_owes' });
    const yosef = rows.find((row) => row.description.includes('יוסף'))!;
    expect(yosef.amountAgorot).toBe(1524000);
    expect(yosef.settledAgorot).toBe(1433000);
    expect(yosef.outstandingAgorot).toBe(91000);
  });

  it('seeds all twelve reimbursements, including the two with no name', async () => {
    await seedCampBaseline(db, LEAD);
    const { listObligations, unnamedObligations } = await import('@/lib/money/obligations');
    const all = await listObligations(db, { direction: 'camp_owes' });
    const reimbursements = all.filter((row) => row.description !== 'חוב יוסף');
    expect(reimbursements).toHaveLength(12);
    expect(reimbursements.reduce((n, row) => n + row.amountAgorot, 0)).toBe(595400);
    expect(await unnamedObligations(db)).toHaveLength(2);
  });

  /**
   * `first.movements` used to be the third assertion here. There is no
   * `movements` counter any more — the seed writes no ledger row on any run,
   * first or second — so the assertion is re-pointed at the fact it was
   * guarding rather than deleted: the ledger stays empty across two runs.
   * `listMovements` with no filter is camp-wide, so this also catches a row
   * seeded against no season at all, which the two season-scoped tests above
   * would both miss.
   */
  it('is idempotent — the money side', async () => {
    await seedCampBaseline(db, LEAD);
    const first = await seedCampBaseline(db, LEAD);
    expect(first.accounts).toBe(0);
    expect(first.obligations).toBe(0);
    expect(first.budgetLines).toBe(0);

    const { listMovements } = await import('@/lib/money/ledger');
    expect(await listMovements(db, {})).toEqual([]);
  });

  /**
   * `budget_lines` is the single home for a planned amount. The four ברן 25
   * deliverables carried theirs on the task itself; they now point at budget
   * lines too. `budgetAmount` is still written here and by the task form
   * (`createTask`'s deliberate deprecated-in-place carry, documented at
   * `BURN_25_DELIVERABLES`'s own comment) — what's guaranteed is that it
   * never enters a season's budget total: `budgetTotalAgorot` sums only
   * `budget_lines`, so a stray `budgetAmount` can make "did we come in on
   * budget" wrong for one deliverable but can never inflate the season sum.
   */
  it('gives the four ברן 25 deliverables budget lines instead of amounts', async () => {
    await seedCampBaseline(db, LEAD);
    const { listBudgetLines } = await import('@/lib/money/budget');
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;

    const dancefloor = (await listBudgetLines(db, s25.id))
      .filter((line) => line.category === 'dancefloor');
    expect(dancefloor.map((line) => line.label).sort())
      .toEqual(['הגברה + תאורה', 'הובלה', 'חשמל', 'מייצג'].sort());
    expect(dancefloor.reduce((n, line) => n + line.totalAgorot, 0)).toBe(8906000);

    const { listTasks } = await import('@/lib/work/tasks');
    for (const task of await listTasks(db, s25.id)) {
      if (task.kind !== 'deliverable') continue;
      expect(task.budgetLineId).not.toBeNull();
    }
  });

  /**
   * `BURN_25_DELIVERABLES` and the task-creation loop predate this task —
   * any database where `seedCampBaseline` already ran has the four ברן 25
   * deliverable tasks already, with `budgetLineId` still null. This is
   * exactly the shape of Task 13's live dev database: already seeded once,
   * about to be seeded again. Budget-line creation must not be gated behind
   * "the task doesn't exist yet", or these four tasks can never get a
   * budget line, on any future re-run.
   */
  it('backfills dancefloor budget lines for deliverables that already existed', async () => {
    const { createSeason } = await import('@/lib/members/roster');
    const s25 = await createSeason(db, {
      name: 'ברן 25', year: 2025, flatRate: 1500, plannedSize: 43,
    });
    const { createTask, listTasks } = await import('@/lib/work/tasks');
    for (const [title, budget] of [
      ['מייצג', 41300], ['חשמל', 12950], ['הגברה + תאורה', 30810], ['הובלה', 4000],
    ] as const) {
      await createTask(db, {
        seasonId: s25.id, kind: 'deliverable', title, budgetAmount: budget,
      });
    }

    await seedCampBaseline(db, LEAD);

    const { listBudgetLines } = await import('@/lib/money/budget');
    const dancefloor = (await listBudgetLines(db, s25.id))
      .filter((line) => line.category === 'dancefloor');
    expect(dancefloor).toHaveLength(4);
    expect(dancefloor.reduce((n, line) => n + line.totalAgorot, 0)).toBe(8906000);

    for (const task of await listTasks(db, s25.id)) {
      if (task.kind !== 'deliverable') continue;
      expect(task.budgetLineId).not.toBeNull();
    }

    // Re-running once more must add nothing further.
    const again = await seedCampBaseline(db, LEAD);
    expect(again.budgetLines).toBe(0);
    expect(again.tasks).toBe(0);
  });

  it('seeds the whole ברן 26 fundraising plan, flagging only the dues line', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { listFundingTargets, fundingTotalAgorot, campBudgetFundingAgorot } =
      await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    expect(await listFundingTargets(db, s26.id)).toHaveLength(8);
    expect(await fundingTotalAgorot(db, s26.id)).toBe(13537530);
    expect(await campBudgetFundingAgorot(db, s26.id)).toBe(2237530);
  });

  it('seeds the ticket projection: 60,000 + 33,000 + 78,000 = 171,000', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { listTicketRounds, ticketTotalAgorot } = await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    expect(await listTicketRounds(db, s26.id)).toHaveLength(3);
    expect(await ticketTotalAgorot(db, s26.id)).toBe(17100000);
  });

  /**
   * Was `perPersonFullAgorot` 183929 and `closes` true. The two figures that
   * come from the seeded fundraising plan — 22,375.30 and 639.29 per head —
   * are unchanged and still pinned; the two that came from the budget the
   * promoter now owns are 0 and false. Deliberately kept beside the funding
   * tests rather than merged with the identity test above: this one reaches
   * the identity through `fundingTargetAgorot`, and a plan that stopped being
   * flagged `countsTowardCampBudget` would fail here first.
   */
  it('keeps the funding half of the identity, and only that half', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { duesFundingIdentity } = await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    const id = await duesFundingIdentity(db, s26.id);
    expect(id.fundingTargetAgorot).toBe(2237530);
    expect(id.perPersonFundingAgorot).toBe(63929);
    expect(id.perPersonFullAgorot).toBe(0);
    expect(id.closes).toBe(false);
  });
});
