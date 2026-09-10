import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { createEvent } from '@/lib/work/events';
import { createTask, listTasks } from '@/lib/work/tasks';
import {
  assignPerson, setAssignmentStatus, removeAssignment,
  coverageFor, uncoveredTasks, responsibilitiesOf,
} from '@/lib/work/coverage';

const LEAD = 'lead@shliff.camp';

describe('coverage', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 })).id;
  });

  async function shift(title: string, peopleNeeded: number) {
    await createTask(db, {
      seasonId, kind: 'shift', title, peopleNeeded,
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    });
    return (await listTasks(db, seasonId)).find((t) => t.title === title)!.taskId;
  }

  it('reports a task with nobody on it as uncovered', async () => {
    await shift('משמרת בר', 4);
    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(0);
    expect(coverage.uncovered).toBe(true);
    expect(await uncoveredTasks(db, seasonId)).toHaveLength(1);
  });

  it('does not count a proposed assignment as covering anything', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    await assignPerson(db, taskId, ofek, LEAD);

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.assignees).toHaveLength(1);
    expect(coverage.accepted).toBe(0);
    expect(coverage.uncovered).toBe(true);
  });

  it('counts an accepted assignment and closes the gap', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(1);
    expect(coverage.uncovered).toBe(false);
    expect(await uncoveredTasks(db, seasonId)).toEqual([]);
  });

  it('reports a partly staffed shift as still uncovered', async () => {
    const taskId = await shift('משמרת בר', 4);
    for (const name of ['אופק', 'ירין']) {
      const id = await createPerson(db, name, LEAD);
      const assignmentId = await assignPerson(db, taskId, id, LEAD);
      await setAssignmentStatus(db, assignmentId, 'accepted');
    }

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(2);
    expect(coverage.peopleNeeded).toBe(4);
    expect(coverage.uncovered).toBe(true);
  });

  it('stops counting someone who dropped', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');
    await setAssignmentStatus(db, assignmentId, 'dropped');

    expect((await coverageFor(db, seasonId))[0].uncovered).toBe(true);
  });

  it('refuses to assign the same person to a task twice', async () => {
    const taskId = await shift('משמרת בר', 4);
    const ofek = await createPerson(db, 'אופק', LEAD);
    await assignPerson(db, taskId, ofek, LEAD);
    await expect(assignPerson(db, taskId, ofek, LEAD)).rejects.toThrow();
  });

  it('removes an assignment entirely', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await removeAssignment(db, assignmentId);
    expect((await coverageFor(db, seasonId))[0].assignees).toEqual([]);
  });

  it('ignores cancelled tasks in the uncovered report', async () => {
    const taskId = await shift('משמרת בר', 4);
    const { setTaskStatus } = await import('@/lib/work/tasks');
    await setTaskStatus(db, taskId, 'cancelled');
    expect(await uncoveredTasks(db, seasonId)).toEqual([]);
  });

  it('answers "everything אופק is responsible for" across kinds and events', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    const event = await createEvent(db, {
      seasonId, name: 'מסיבת פקאנים', kind: 'fundraiser',
    });
    // The two ownerships the ברן 25 רחבה sheet actually records for אופק.
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'הובלה', budgetAmount: 4000,
    });
    await createTask(db, {
      seasonId, eventId: event.id, kind: 'event_task', title: 'כניסה',
    });

    for (const title of ['חשמל', 'הובלה', 'כניסה']) {
      const task = (await listTasks(db, seasonId)).find((t) => t.title === title)!;
      const id = await assignPerson(db, task.taskId, ofek, LEAD);
      await setAssignmentStatus(db, id, 'accepted');
    }

    const owned = await responsibilitiesOf(db, ofek);
    expect(owned).toHaveLength(3);
    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל', 'כניסה']);
    expect(owned.find((r) => r.title === 'חשמל')?.budgetAgorot).toBe(1295000);
    expect(owned.find((r) => r.title === 'כניסה')?.eventName).toBe('מסיבת פקאנים');
  });
});
