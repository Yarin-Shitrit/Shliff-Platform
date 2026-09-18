import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createPerson } from '@/lib/members/link';
import { createEvent } from '@/lib/work/events';
import { createTask, listTasks, setTaskStatus } from '@/lib/work/tasks';
import { createBudgetLine } from '@/lib/money/budget';
import {
  assignPerson, setAssignmentStatus, removeAssignment,
  coverageFor, uncoveredTasks, responsibilitiesOf,
  covers, summarize, seasonCoverageTotals,
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

  /**
   * After the burn a lead marks shifts done. If `done` stopped counting as
   * covered, every completed shift would reappear as a staffing gap — the
   * report would be at its most wrong exactly when the work is finished.
   */
  it('keeps counting someone who has finished the work', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');
    await setAssignmentStatus(db, assignmentId, 'done');

    const [coverage] = await coverageFor(db, seasonId);
    expect(coverage.accepted).toBe(1);
    expect(coverage.uncovered).toBe(false);
    expect(await uncoveredTasks(db, seasonId)).toEqual([]);
  });

  it('stops counting someone who dropped', async () => {
    const taskId = await shift('משמרת בר', 1);
    const ofek = await createPerson(db, 'אופק', LEAD);
    const assignmentId = await assignPerson(db, taskId, ofek, LEAD);
    await setAssignmentStatus(db, assignmentId, 'accepted');
    await setAssignmentStatus(db, assignmentId, 'dropped');

    expect((await coverageFor(db, seasonId))[0].uncovered).toBe(true);
  });

  /**
   * mergePersons refuses to merge someone who already has an assignment, but
   * nothing stopped a NEW assignment landing on the merged-away id afterwards.
   * Such a row is counted as staffed on the board yet invisible on every page
   * a lead would look at, because listPeople and resolveName both hide merged
   * rows — the work would be quietly covered and quietly unreachable.
   */
  it('refuses to assign work to a person who was merged away', async () => {
    const { mergePersons } = await import('@/lib/members/link');
    const taskId = await shift('משמרת בר', 1);
    const survivor = await createPerson(db, 'אופק', LEAD);
    const folded = await createPerson(db, 'אופק כהן', LEAD);
    expect((await mergePersons(db, folded, survivor, LEAD)).ok).toBe(true);

    await expect(assignPerson(db, taskId, folded, LEAD))
      .rejects.toThrow(/merged into another/);
    await expect(assignPerson(db, taskId, survivor, LEAD)).resolves.toBeDefined();
  });

  /**
   * The task board renders budget and timing straight off the coverage row.
   * Before these fields travelled with it, the page had to query listTasks for
   * the same season a second time just to show a budget, and a recurring shift
   * was indistinguishable from another with the same title.
   */
  it('carries the budget and timing the board needs, without a second query', async () => {
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    await createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר', peopleNeeded: 2,
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    });

    const coverage = await coverageFor(db, seasonId);
    const deliverable = coverage.find((t) => t.title === 'חשמל')!;
    const bar = coverage.find((t) => t.title === 'משמרת בר')!;

    expect(deliverable.budgetAgorot).toBe(1295000);
    expect(deliverable.startsAt).toBeNull();
    expect(bar.budgetAgorot).toBeNull();
    expect(bar.startsAt).toBeInstanceOf(Date);
    expect(bar.endsAt).toBeInstanceOf(Date);
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

  /**
   * Someone who dropped out is no longer responsible, but someone merely
   * proposed still is — a lead needs to see what they have offered and not yet
   * had answered.
   */
  it('drops the dropped from responsibilities but keeps the merely proposed', async () => {
    const ofek = await createPerson(db, 'אופק', LEAD);
    await createTask(db, { seasonId, kind: 'deliverable', title: 'חשמל' });
    await createTask(db, { seasonId, kind: 'deliverable', title: 'הגברה' });

    const all = await listTasks(db, seasonId);
    const kept = all.find((t) => t.title === 'חשמל')!;
    const gone = all.find((t) => t.title === 'הגברה')!;
    await assignPerson(db, kept.taskId, ofek, LEAD); // stays 'proposed'
    const dropped = await assignPerson(db, gone.taskId, ofek, LEAD);
    await setAssignmentStatus(db, dropped, 'dropped');

    const owned = await responsibilitiesOf(db, ofek);
    expect(owned.map((r) => r.title)).toEqual(['חשמל']);
    expect(owned[0].status).toBe('proposed');
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
    // A person's own list must be able to say WHEN, or it does not answer
    // "what am I responsible for" in any useful sense.
    expect(owned.every((r) => 'startsAt' in r && 'dueOn' in r)).toBe(true);
    expect(owned).toHaveLength(3);
    expect(owned.map((r) => r.title).sort()).toEqual(['הובלה', 'חשמל', 'כניסה']);
    expect(owned.find((r) => r.title === 'חשמל')?.budgetAgorot).toBe(1295000);
    expect(owned.find((r) => r.title === 'כניסה')?.eventName).toBe('מסיבת פקאנים');
  });

  it('carries the deliverable\'s budget line on the coverage row', async () => {
    const lineId = await createBudgetLine(db, {
      seasonId, label: 'גנרטור וחשמל', total: 41300, category: 'camp',
    });
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'גנרטור וחשמל', budgetLineId: lineId,
    });
    const row = (await coverageFor(db, seasonId))
      .find((task) => task.title === 'גנרטור וחשמל')!;
    expect(row.budgetLineId).toBe(lineId);
    expect(row.budgetLineLabel).toBe('גנרטור וחשמל');
    expect(row.budgetLineTotalAgorot).toBe(4_130_000);
  });

  it('carries the event date, so an event task has a when', async () => {
    const event = await createEvent(db, {
      seasonId, name: 'מסיבת אוקטובר', kind: 'fundraiser',
      heldOn: new Date('2026-10-04T20:00:00Z'),
    });
    await createTask(db, {
      seasonId, kind: 'event_task', title: 'דלת', eventId: event.id,
    });
    const row = (await coverageFor(db, seasonId)).find((t) => t.title === 'דלת')!;
    expect(row.eventHeldOn).toEqual(new Date('2026-10-04T20:00:00Z'));
  });

  it('counts accepted and done as covering, and nothing else', () => {
    expect(covers('accepted')).toBe(true);
    expect(covers('done')).toBe(true);
    expect(covers('proposed')).toBe(false);
    expect(covers('dropped')).toBe(false);
  });

  describe('summarize', () => {
    it('reports the season in one sentence: filled out of needed', async () => {
      const barId = await shift('משמרת בר', 4);
      const quietId = await shift('משמרת שקט', 2);
      for (const name of ['נועה', 'איתי']) {
        const personId = await createPerson(db, name, LEAD);
        const assignmentId = await assignPerson(db, barId, personId, LEAD);
        await setAssignmentStatus(db, assignmentId, 'accepted');
      }
      const totals = summarize(await coverageFor(db, seasonId));
      expect(totals.tasks).toBe(2);
      expect(totals.placesNeeded).toBe(6);
      expect(totals.placesFilled).toBe(2);
      expect(totals.uncoveredTasks).toBe(2);
      expect(quietId).toBeDefined();
    });

    it('caps a task at the places it needs, so the season cannot overfill', async () => {
      const taskId = await shift('משמרת בר', 1);
      for (const name of ['נועה', 'איתי', 'רוני']) {
        const personId = await createPerson(db, name, LEAD);
        const assignmentId = await assignPerson(db, taskId, personId, LEAD);
        await setAssignmentStatus(db, assignmentId, 'accepted');
      }
      const totals = summarize(await coverageFor(db, seasonId));
      expect(totals.placesNeeded).toBe(1);
      expect(totals.placesFilled).toBe(1);
    });

    it('leaves a closed task out of the places figures', async () => {
      const taskId = await shift('משמרת בר', 4);
      await setTaskStatus(db, taskId, 'done');
      const totals = summarize(await coverageFor(db, seasonId));
      expect(totals.tasks).toBe(1);
      expect(totals.openTasks).toBe(0);
      expect(totals.placesNeeded).toBe(0);
    });

    it('counts the tasks with no date at all', async () => {
      await createTask(db, { seasonId, kind: 'deliverable', title: 'סאונד רחבה' });
      await shift('משמרת בר', 1);
      expect(summarize(await coverageFor(db, seasonId)).datelessTasks).toBe(1);
    });

    it('counts a shared budget line once', async () => {
      const lineId = await createBudgetLine(db, {
        seasonId, label: 'גנרטור וחשמל', total: 41300, category: 'camp',
      });
      await createTask(db, { seasonId, kind: 'deliverable', title: 'גנרטור', budgetLineId: lineId });
      await createTask(db, { seasonId, kind: 'deliverable', title: 'חשמל', budgetLineId: lineId });
      expect(summarize(await coverageFor(db, seasonId)).linkedBudgetAgorot).toBe(4_130_000);
    });

    it('is what seasonCoverageTotals returns, from the same rows', async () => {
      await shift('משמרת בר', 4);
      expect(await seasonCoverageTotals(db, seasonId))
        .toEqual(summarize(await coverageFor(db, seasonId)));
    });
  });
});
