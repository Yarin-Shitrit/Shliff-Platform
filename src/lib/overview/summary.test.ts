import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { recordUnlinkedName } from '@/lib/members/identity';
import { issueFlatDues, listDues } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { createAccount } from '@/lib/money/accounts';
import { createBudgetLine } from '@/lib/money/budget';
import { createObligation } from '@/lib/money/obligations';
import { createTask } from '@/lib/work/tasks';
import { assignPerson } from '@/lib/work/coverage';
import { seasonOverview } from '@/lib/overview/summary';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('seasonOverview', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, {
      name: 'ברן 26', year: 2026, flatRate: 1200, plannedSize: 35,
    })).id;
  });

  it('reports nothing at all for a season that has only just been created', async () => {
    const overview = await seasonOverview(db, seasonId);

    // Every figure absent, not zero. A zero here would draw four cards that
    // say nothing, on the one screen a lead opens to decide what to do.
    expect(overview.dues).toBeNull();
    expect(overview.cash).toBeNull();
    expect(overview.debts).toBeNull();
    expect(overview.coverage).toBeNull();
    expect(overview.seasonId).toBe(seasonId);
    expect(overview.seasonName).toBe('ברן 26');
    expect(overview.memberCount).toBe(0);
    expect(overview.flatRateAgorot).toBe(120000);
    expect(overview.understaffed).toEqual([]);
    expect(overview.decisions).toEqual({ total: 0, items: [] });
  });

  it('answers the four figures in one call', async () => {
    for (const name of ['איתי כהן', 'גיל ברק', 'מיכל רוזן']) {
      await addMember(db, await createPerson(db, name, LEAD), seasonId);
    }
    await issueFlatDues(db, seasonId);
    const rows = await listDues(db, seasonId);
    const account = await createAccount(db, {
      name: 'קופת מזומן', kind: 'cash', openingBalance: 1000,
    });
    await recordPayment(db, {
      dueId: rows[0].dueId, amount: 1200, channel: 'העברה',
      paidOn: WHEN, recordedBy: LEAD, accountId: account.id,
    });
    await createObligation(db, {
      direction: 'camp_owes', partyName: 'דנה', description: 'תיקון גנרטור',
      amount: 800, seasonId, openedOn: WHEN,
    });
    await createObligation(db, {
      direction: 'owed_to_camp', partyName: 'יוסי', description: 'מקדמה על אוהל',
      amount: 450, seasonId, openedOn: WHEN,
    });
    const shade = await createTask(db, {
      seasonId, kind: 'build', title: 'הקמת הצל', peopleNeeded: 4,
    });
    await assignPerson(db, shade, await createPerson(db, 'רן', LEAD), LEAD, 'accepted');

    const overview = await seasonOverview(db, seasonId);

    expect(overview.dues).toEqual({
      expectedAgorot: 360000,
      collectedAgorot: 120000,
      outstandingAgorot: 240000,
      unpaidCount: 2,
      partlyPaidCount: 0,
      missingDuesCount: 0,
      unpaid: overview.dues!.unpaid,
    });
    expect(overview.dues!.unpaid).toHaveLength(2);
    // Opening balance 1,000 plus the 1,200 dues payment that landed in it —
    // a dues payment is money that physically arrived somewhere.
    expect(overview.cash).toEqual({
      totalAgorot: 220000, accountCount: 1, unattributedInAgorot: 0,
    });
    expect(overview.debts).toEqual({
      campOwesAgorot: 80000, owedToCampAgorot: 45000, unnamedCount: 0,
    });
    // Plan 10's `SeasonCoverage`, inherited whole (I1). The four fields the
    // home's tile actually reads are asserted by value; the rest of that
    // shape belongs to `/tasks` and is pinned by plan 10's own tests.
    expect(overview.coverage).not.toBeNull();
    expect(overview.coverage!.placesNeeded).toBe(4);
    expect(overview.coverage!.placesFilled).toBe(1);
    expect(overview.coverage!.uncoveredTasks).toBe(1);
    expect(overview.coverage!.openTasks).toBe(1);
    expect(overview.understaffed.map((task) => task.title)).toEqual(['הקמת הצל']);
  });

  it('shows the cash card for money with no account, even when no account exists', async () => {
    await addMember(db, await createPerson(db, 'איתי כהן', LEAD), seasonId);
    await issueFlatDues(db, seasonId);
    const [due] = await listDues(db, seasonId);
    await recordPayment(db, {
      dueId: due.dueId, amount: 400, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });

    const overview = await seasonOverview(db, seasonId);
    // No account row exists, so a naive `accounts.length === 0 → null` hides
    // the one thing a lead must chase: 400 shekels the camp holds and cannot
    // place. The card appears, reading 0 across 0 accounts, with the warning.
    expect(overview.cash).toEqual({
      totalAgorot: 0, accountCount: 0, unattributedInAgorot: 40000,
    });
  });

  it('counts a part payment as a member who has paid something and still owes', async () => {
    for (const name of ['הילה נחום', 'עומר ביטון']) {
      await addMember(db, await createPerson(db, name, LEAD), seasonId);
    }
    await issueFlatDues(db, seasonId);
    const rows = await listDues(db, seasonId);
    await recordPayment(db, {
      dueId: rows.find((r) => r.displayName === 'הילה נחום')!.dueId,
      amount: 500, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });

    const overview = await seasonOverview(db, seasonId);
    expect(overview.dues!.unpaidCount).toBe(2);
    expect(overview.dues!.partlyPaidCount).toBe(1);
  });

  it('keeps a season-less unnamed debt visible on the season that is open', async () => {
    await createObligation(db, {
      direction: 'camp_owes', description: 'הובלה', amount: 740, openedOn: WHEN,
    });

    const overview = await seasonOverview(db, seasonId);
    // The debt belongs to no season, so it is in neither direction's
    // season-scoped total — but it is the camp's, and the one screen everybody
    // opens must not be the one screen it cannot reach.
    expect(overview.debts).toEqual({
      campOwesAgorot: 0, owedToCampAgorot: 0, unnamedCount: 1,
    });
  });

  it('orders the understaffed tasks by how many people are missing', async () => {
    const shade = await createTask(db, {
      seasonId, kind: 'build', title: 'הקמת הצל', peopleNeeded: 8,
    });
    await createTask(db, {
      seasonId, kind: 'build', title: 'פירוק ו־MOOP', peopleNeeded: 6,
    });
    await createTask(db, {
      seasonId, kind: 'build', title: 'מסיבת גיוס — דלת', peopleNeeded: 2,
    });
    for (const name of ['רא', 'יל', 'דש']) {
      await assignPerson(db, shade, await createPerson(db, name, LEAD), LEAD, 'accepted');
    }

    const overview = await seasonOverview(db, seasonId);
    // הצל is short 5, MOOP short 6, the door short 2 — the biggest gap leads,
    // not the alphabet and not the insertion order.
    expect(overview.understaffed.map((task) => task.title))
      .toEqual(['פירוק ו־MOOP', 'הקמת הצל', 'מסיבת גיוס — דלת']);
  });

  it('carries the register\'s open decisions, and sends each one to the register', async () => {
    await recordUnlinkedName(db, 'נועה ל.', 'import');
    await recordUnlinkedName(db, 'Itay', 'import');

    const overview = await seasonOverview(db, seasonId);

    expect(overview.decisions.total).toBe(2);
    expect(overview.decisions.items.map((item) => item.title).sort())
      .toEqual(['״Itay״', '״נועה ל.״'].sort());
    for (const item of overview.decisions.items) {
      expect(item.kind).toBe('unlinked-name');
      // I2: the home names a decision and hands it on. Every row goes to the
      // register — never to the action that would settle it, and never to the
      // domain page the register's own action links to.
      // Parsed rather than re-spelled: asserting the same template the code
      // writes would pass over an id the URL cannot carry.
      const url = new URL(item.href, 'https://shliff.invalid');
      expect(url.pathname).toBe('/inbox');
      expect(url.searchParams.get('item')).toBe(item.id);
      expect(item.actionLabel.length).toBeGreaterThan(0);
      // A name is a decision, but promotion is not waiting on it: gating
      // promotion on the queue promotion itself fills is a deadlock.
      expect(item.blocksImport).toBe(false);
    }
    // `unlinkedCount` is gone: the register owns that number now, and two
    // sources for one count is how they start disagreeing.
    expect('unlinkedCount' in overview).toBe(false);
  });

  it('counts decisions, not everything the register lists', async () => {
    await recordUnlinkedName(db, 'נועה ל.', 'import');
    // 2 × 1 ₪ is not 5 ₪. The register carries it, and it is not a decision:
    // nobody is being asked to choose anything, so a badge that counted it
    // would send a lead to the register to find nothing waiting there.
    await createBudgetLine(db, {
      seasonId, label: 'גנרטור', quantityNum: 2, unitCost: 1, total: 5,
      category: 'camp',
    });

    const overview = await seasonOverview(db, seasonId);

    expect(overview.decisions.total).toBe(1);
    expect(overview.decisions.items.map((item) => item.kind)).toEqual(['unlinked-name']);
  });

  it('shows six decisions at most, and still says how many there are', async () => {
    for (const name of ['אבי', 'בני', 'גלי', 'דנה', 'הדר', 'ורד', 'זיו', 'חן']) {
      await recordUnlinkedName(db, name, 'import');
    }

    const overview = await seasonOverview(db, seasonId);
    // Eight waiting, six shown. The panel never counts its own rows to learn
    // how many there are — that is what hid the other two.
    expect(overview.decisions.total).toBe(8);
    expect(overview.decisions.items).toHaveLength(6);
  });
});
