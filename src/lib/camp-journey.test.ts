import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { getSeasonByName, listRoster, addMember } from '@/lib/members/roster';
import { resolveName, recordUnlinkedName, listUnlinkedNames } from '@/lib/members/identity';
import { createPerson, linkAlias, mergePersons } from '@/lib/members/link';
import { listDues, issueFlatDues } from '@/lib/fees/dues';
import { settlementFor, recordPayment } from '@/lib/fees/payments';
import { seasonFeeSummary } from '@/lib/fees/summary';
import { uncoveredTasks, responsibilitiesOf } from '@/lib/work/coverage';
import { createTask, listTasks } from '@/lib/work/tasks';
import { personDossier } from '@/lib/members/dossier';
import { seedCampBaseline } from '@/lib/seed/camp-seed';

const LEAD = 'lead@shliff.camp';

describe('a year at Shliff', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('runs from seed to a settled season without losing a shekel', async () => {
    await seedCampBaseline(db, LEAD);

    // 1. אופק is one person, with two deliverables — the case the
    //    spreadsheets cannot express.
    const ofek = await resolveName(db, 'אופק');
    expect(ofek.personId).not.toBeNull();
    const owned = await responsibilitiesOf(db, ofek.personId!);
    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל']);

    // 2. A second spelling arrives from an import. Nothing is merged
    //    automatically — it lands in the queue.
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('אופק כהן');
    expect((await resolveName(db, 'אופק כהן')).personId).toBeNull();

    // 3. A lead links it. Now both spellings reach one dossier.
    await linkAlias(db, aliasId, ofek.personId!, LEAD);
    const dossier = await personDossier(db, ofek.personId!);
    expect(dossier!.aliases.map((a) => a.alias).sort()).toEqual(['אופק', 'אופק כהן']);

    // 4. ברן 25 reconciles: five documented exceptions, each with a reason.
    const s25 = (await getSeasonByName(db, 'ברן 25'))!;
    const dues25 = await listDues(db, s25.id);
    const exceptions = dues25.filter((d) => d.kind === 'exception');
    expect(exceptions).toHaveLength(5);
    expect(exceptions.every((d) => (d.exceptionReason ?? '').length > 0)).toBe(true);
    expect(exceptions.every((d) => d.decidedBy !== null)).toBe(true);

    // 5. ברן 26: five dues, all settled by one 6,000 offset.
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const before = await seasonFeeSummary(db, s26.id);
    expect(before.collectedAgorot).toBe(600000);
    expect(before.outstandingAgorot).toBe(0);

    // 6. A new member joins ברן 26 and pays in two goes through two channels.
    const dana = await createPerson(db, 'דנה', LEAD);
    await addMember(db, dana, s26.id);
    await issueFlatDues(db, s26.id);
    const danaDue = (await listDues(db, s26.id)).find((d) => d.displayName === 'דנה')!;
    expect(danaDue.amountAgorot).toBe(120000);

    const mid = await seasonFeeSummary(db, s26.id);
    expect(mid.expectedAgorot).toBe(720000);
    expect(mid.outstandingAgorot).toBe(120000);
    expect(mid.unpaidCount).toBe(1);

    await recordPayment(db, {
      dueId: danaDue.dueId, amount: 700, channel: 'ביט',
      paidOn: new Date('2026-08-01T00:00:00Z'), recordedBy: LEAD,
    });
    await recordPayment(db, {
      dueId: danaDue.dueId, amount: 500, channel: 'מזומן',
      paidOn: new Date('2026-08-05T00:00:00Z'), recordedBy: LEAD,
    });
    expect((await settlementFor(db, danaDue.dueId)).settled).toBe(true);

    const after = await seasonFeeSummary(db, s26.id);
    expect(after.expectedAgorot).toBe(720000);
    expect(after.collectedAgorot).toBe(720000);
    expect(after.outstandingAgorot).toBe(0);
    expect(after.unpaidCount).toBe(0);
    expect(after.missingDues).toEqual([]);

    // 7. A bar shift is added and staffed. Coverage tracks it honestly.
    await createTask(db, {
      seasonId: s26.id, kind: 'shift', title: 'משמרת בר', peopleNeeded: 2,
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    });
    expect((await uncoveredTasks(db, s26.id)).map((t) => t.title)).toEqual(['משמרת בר']);

    const shift = (await listTasks(db, s26.id, { kind: 'shift' }))[0];
    const { assignPerson, setAssignmentStatus } = await import('@/lib/work/coverage');
    for (const personId of [ofek.personId!, dana]) {
      const id = await assignPerson(db, shift.taskId, personId, LEAD);
      await setAssignmentStatus(db, id, 'accepted');
    }
    expect(await uncoveredTasks(db, s26.id)).toEqual([]);

    // 8. The queued `ראנצ׳ו ונטלי` is still unresolved — by design.
    expect((await listUnlinkedNames(db)).map((n) => n.alias)).toContain('ראנצ׳ו ונטלי');
  });

  it('never lets a merge combine two people who both have money', async () => {
    await seedCampBaseline(db, LEAD);
    const ofek = await resolveName(db, 'אופק');
    const yosef = await resolveName(db, 'יוסף');

    // Both are on rosters and both have dues — merging would be irreversible.
    const result = await mergePersons(db, ofek.personId!, yosef.personId!, LEAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts.length).toBeGreaterThan(0);

    // Nothing moved.
    expect((await resolveName(db, 'אופק')).personId).toBe(ofek.personId);
    expect((await resolveName(db, 'יוסף')).personId).toBe(yosef.personId);
  });

  it('re-seeding after a season has been worked changes nothing', async () => {
    await seedCampBaseline(db, LEAD);
    const s26 = (await getSeasonByName(db, 'ברן 26'))!;
    const before = await seasonFeeSummary(db, s26.id);
    const roster = await listRoster(db, s26.id);

    await seedCampBaseline(db, LEAD);

    const after = await seasonFeeSummary(db, s26.id);
    expect(after).toEqual(before);
    expect(await listRoster(db, s26.id)).toHaveLength(roster.length);
  });
});
