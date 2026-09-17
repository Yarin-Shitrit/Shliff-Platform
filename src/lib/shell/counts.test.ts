import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason, addMember } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { recordUnlinkedName } from '@/lib/members/identity';
import { createObligation } from '@/lib/money/obligations';
import { createTask, listTasks } from '@/lib/work/tasks';
import { assignPerson, setAssignmentStatus } from '@/lib/work/coverage';
import { shellCounts } from '@/lib/shell/counts';

const LEAD = 'lead@shliff.camp';

describe('shellCounts', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  });

  it('counts nothing when there is nothing to decide', async () => {
    expect(await shellCounts(db, seasonId))
      .toEqual({ openDecisions: 0, rosterSize: 0, understaffedTasks: 0 });
  });

  it('counts an unlinked name and a nameless debt as open decisions', async () => {
    await recordUnlinkedName(db, 'נועה ל.', 'import');
    await createObligation(db, {
      direction: 'camp_owes',
      description: 'מקפיא באיחסון נוסף',
      amount: 500,
      openedOn: null,
    });
    expect((await shellCounts(db, seasonId)).openDecisions).toBe(2);
  });

  it('counts the roster of the season it was asked about', async () => {
    const other = await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 });
    const noa = await createPerson(db, 'נועה לוי', LEAD);
    const ofek = await createPerson(db, 'אופק', LEAD);
    await addMember(db, noa, seasonId);
    await addMember(db, ofek, seasonId);
    await addMember(db, noa, other.id);

    expect((await shellCounts(db, seasonId)).rosterSize).toBe(2);
    expect((await shellCounts(db, other.id)).rosterSize).toBe(1);
  });

  it('counts a task nobody has accepted as understaffed, and stops counting it once covered', async () => {
    await createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר', peopleNeeded: 1,
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    });
    const taskId = (await listTasks(db, seasonId))[0].taskId;
    expect((await shellCounts(db, seasonId)).understaffedTasks).toBe(1);

    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');
    expect((await shellCounts(db, seasonId)).understaffedTasks).toBe(0);
  });

  it('answers with camp-wide decisions and no season figures when there is no season', async () => {
    await recordUnlinkedName(db, 'נועה ל.', 'import');
    expect(await shellCounts(db, null))
      .toEqual({ openDecisions: 1, rosterSize: 0, understaffedTasks: 0 });
  });
});
