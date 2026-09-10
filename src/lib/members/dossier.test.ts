import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { recordUnlinkedName } from '@/lib/members/identity';
import { linkAlias } from '@/lib/members/link';
import { issueFlatDues, listDues, setException } from '@/lib/fees/dues';
import { recordPayment } from '@/lib/fees/payments';
import { createTask, listTasks } from '@/lib/work/tasks';
import { assignPerson, setAssignmentStatus } from '@/lib/work/coverage';
import { personDossier, listPeople } from '@/lib/members/dossier';

const LEAD = 'lead@shliff.camp';
const WHEN = new Date('2026-07-01T00:00:00Z');

describe('personDossier', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('gathers every spelling, season, due and responsibility for one person', async () => {
    const s25 = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const s26 = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });

    const ofek = await createPerson(db, 'אופק', LEAD);
    const aliasId = await recordUnlinkedName(db, 'אופק כהן', 'import');
    await linkAlias(db, aliasId, ofek, LEAD);

    await addMember(db, ofek, s25.id);
    await addMember(db, ofek, s26.id, 'lead');
    await issueFlatDues(db, s25.id);
    await issueFlatDues(db, s26.id);

    const due25 = (await listDues(db, s25.id))[0];
    await recordPayment(db, {
      dueId: due25.dueId, amount: 1500, channel: 'ביט', paidOn: WHEN, recordedBy: LEAD,
    });

    // The two deliverables the ברן 25 רחבה sheet records for אופק.
    for (const [title, budget] of [['חשמל', 12950], ['הובלה', 4000]] as const) {
      await createTask(db, {
        seasonId: s25.id, kind: 'deliverable', title, budgetAmount: budget,
      });
      const task = (await listTasks(db, s25.id)).find((t) => t.title === title)!;
      const id = await assignPerson(db, task.taskId, ofek, LEAD);
      await setAssignmentStatus(db, id, 'accepted');
    }

    const dossier = await personDossier(db, ofek);
    expect(dossier).not.toBeNull();
    expect(dossier!.displayName).toBe('אופק');
    expect(dossier!.aliases.map((a) => a.alias).sort()).toEqual(['אופק', 'אופק כהן']);
    expect(dossier!.seasons.map((s) => s.seasonName).sort()).toEqual(['ברן 25', 'ברן 26']);

    expect(dossier!.dues).toHaveLength(2);
    const paid = dossier!.dues.find((d) => d.seasonName === 'ברן 25')!;
    expect(paid.paidAgorot).toBe(150000);
    expect(paid.settled).toBe(true);
    const owing = dossier!.dues.find((d) => d.seasonName === 'ברן 26')!;
    expect(owing.outstandingAgorot).toBe(120000);
    expect(owing.settled).toBe(false);

    expect(dossier!.responsibilities).toHaveLength(2);
    expect(dossier!.responsibilities.map((r) => r.title).sort())
      .toEqual(['הובלה', 'חשמל']);
  });

  it('carries an exception reason into the dossier', async () => {
    const season = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const amiram = await createPerson(db, 'עמירם דהן', LEAD);
    await addMember(db, amiram, season.id);
    await issueFlatDues(db, season.id);
    await setException(db, {
      personId: amiram, seasonId: season.id, amount: 0,
      reason: 'פטור מלא — הוביל את ההקמה', decidedBy: LEAD,
    });

    const dossier = await personDossier(db, amiram);
    expect(dossier!.dues[0].kind).toBe('exception');
    expect(dossier!.dues[0].exceptionReason).toBe('פטור מלא — הוביל את ההקמה');
    expect(dossier!.dues[0].decidedBy).toBe(LEAD);
    expect(dossier!.dues[0].settled).toBe(true);
  });

  it('returns null for an unknown person', async () => {
    expect(await personDossier(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('listPeople', () => {
  let db: TestDb;
  beforeEach(async () => { db = await createTestDb(); });

  it('lists people with what they still owe, hiding merged-away rows', async () => {
    const season = await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 });
    const ofek = await createPerson(db, 'אופק', LEAD);
    const yosef = await createPerson(db, 'יוסף', LEAD);
    await addMember(db, ofek, season.id);
    await addMember(db, yosef, season.id);
    await issueFlatDues(db, season.id);

    const rows = await listPeople(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].displayName).toBe('אופק');
    expect(rows[0].outstandingAgorot).toBe(120000);
    expect(rows[0].seasonCount).toBe(1);
  });

  it('excludes a person who was merged into another', async () => {
    const { mergePersons } = await import('@/lib/members/link');
    const target = await createPerson(db, 'אופק', LEAD);
    const source = await createPerson(db, 'אופק כהן', LEAD);
    await mergePersons(db, source, target, LEAD);

    const rows = await listPeople(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].personId).toBe(target);
    expect(rows[0].aliasCount).toBe(2);
  });
});
