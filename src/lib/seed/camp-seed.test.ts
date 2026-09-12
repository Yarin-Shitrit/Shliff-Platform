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
   * The one test that actually looks at ברן 25's own movements. Without it,
   * seeding the 44,647 `מעבר לקובץ חדש` row as income (exactly the mistake
   * `LEDGER_25`'s own comment explains) passes every other test in this file,
   * because the ברן 26 ledger test below is filtered to ברן 26 and never
   * sees a ברן 25 row at all.
   */
  it('reproduces the ברן 25 ledger bottom line, with no carry-forward row', async () => {
    await seedCampBaseline(db, LEAD);
    const { ledgerTotals } = await import('@/lib/money/ledger');
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const totals = await ledgerTotals(db, { seasonId: s25.id });
    expect(totals.outAgorot).toBe(5077000);
    expect(totals.inAgorot).toBe(5030655);
    expect(totals.netAgorot).toBe(-46345);
  });

  it('reproduces the ברן 26 ledger bottom line', async () => {
    await seedCampBaseline(db, LEAD);
    const { ledgerTotals } = await import('@/lib/money/ledger');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const totals = await ledgerTotals(db, { seasonId: s26.id });
    expect(totals.outAgorot).toBe(4527100);
    expect(totals.inAgorot).toBe(6200000);
    expect(totals.netAgorot).toBe(1672900);
  });

  it('closes the ברן 26 dues/fundraising identity from seeded rows', async () => {
    await seedCampBaseline(db, LEAD);
    const { duesFundingIdentity } = await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const identity = await duesFundingIdentity(db, s26.id);
    expect(identity.budgetTotalAgorot).toBe(6437530);
    expect(identity.perPersonFullAgorot).toBe(183929);
    expect(identity.perPersonFundingAgorot).toBe(63929);
    expect(identity.closes).toBe(true);
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

  it('is idempotent — the money side', async () => {
    await seedCampBaseline(db, LEAD);
    const first = await seedCampBaseline(db, LEAD);
    expect(first.accounts).toBe(0);
    expect(first.movements).toBe(0);
    expect(first.obligations).toBe(0);
  });

  /**
   * `budget_lines` is the single home for a planned amount. The four ברן 25
   * deliverables carried theirs on the task itself; they now point at budget
   * lines instead, and nothing writes `budgetAmount` again. Two homes for one
   * number means "total planned spend" is a union and "did we come in on
   * budget" forks in two.
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

  it('the identity still closes against the seeded plan', async () => {
    await seedCampBaseline(db, LEAD);
    const { getSeasonByName } = await import('@/lib/members/roster');
    const { duesFundingIdentity } = await import('@/lib/money/funding');
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;

    const id = await duesFundingIdentity(db, s26.id);
    expect(id.fundingTargetAgorot).toBe(2237530);
    expect(id.perPersonFullAgorot).toBe(183929);
    expect(id.perPersonFundingAgorot).toBe(63929);
    expect(id.closes).toBe(true);
  });
});
