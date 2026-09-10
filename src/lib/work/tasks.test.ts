import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '@/test/db';
import { createSeason } from '@/lib/members/roster';
import { createEvent, listEvents } from '@/lib/work/events';
import { createTask, listTasks, setTaskStatus } from '@/lib/work/tasks';

describe('events', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 26', year: 2026, flatRate: 1200 })).id;
  });

  it('records fundraising parties and the burn itself', async () => {
    await createEvent(db, {
      seasonId, name: 'מסיבת פקאנים', kind: 'fundraiser',
      heldOn: new Date('2026-07-18T00:00:00Z'),
    });
    await createEvent(db, { seasonId, name: 'מידברן 26', kind: 'burn' });

    const events = await listEvents(db, seasonId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind).sort()).toEqual(['burn', 'fundraiser']);
  });
});

describe('tasks', () => {
  let db: TestDb;
  let seasonId: string;

  beforeEach(async () => {
    db = await createTestDb();
    seasonId = (await createSeason(db, { name: 'ברן 25', year: 2025, flatRate: 1500 })).id;
  });

  it('records a deliverable with its budget', async () => {
    await createTask(db, {
      seasonId, kind: 'deliverable', title: 'חשמל', budgetAmount: 12950,
    });
    const [task] = await listTasks(db, seasonId);
    expect(task.kind).toBe('deliverable');
    expect(task.budgetAgorot).toBe(1295000);
    expect(task.peopleNeeded).toBe(1);
  });

  it('records a shift needing several people', async () => {
    await createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר',
      startsAt: new Date('2026-10-01T20:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
      peopleNeeded: 4,
    });
    const [task] = await listTasks(db, seasonId);
    expect(task.peopleNeeded).toBe(4);
    expect(task.startsAt).toBeInstanceOf(Date);
  });

  it('refuses a shift with no time window', async () => {
    await expect(createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר', peopleNeeded: 4,
    })).rejects.toThrow(/time window/);
  });

  it('refuses a shift that ends before it starts', async () => {
    await expect(createTask(db, {
      seasonId, kind: 'shift', title: 'משמרת בר',
      startsAt: new Date('2026-10-02T00:00:00Z'),
      endsAt: new Date('2026-10-01T20:00:00Z'),
    })).rejects.toThrow(/before/);
  });

  it('refuses an event task with no event', async () => {
    await expect(createTask(db, {
      seasonId, kind: 'event_task', title: 'כניסה',
    })).rejects.toThrow(/event/);
  });

  it('accepts build work with a deadline and without one', async () => {
    await createTask(db, {
      seasonId, kind: 'build', title: 'הובלת מכולה',
      dueOn: new Date('2026-09-01T00:00:00Z'),
    });
    await createTask(db, { seasonId, kind: 'build', title: 'סידור מחסן' });
    expect(await listTasks(db, seasonId)).toHaveLength(2);
  });

  it('filters by kind', async () => {
    await createTask(db, { seasonId, kind: 'deliverable', title: 'חשמל' });
    await createTask(db, { seasonId, kind: 'build', title: 'סידור מחסן' });

    expect(await listTasks(db, seasonId, { kind: 'deliverable' })).toHaveLength(1);
    expect(await listTasks(db, seasonId, { kind: 'shift' })).toHaveLength(0);
  });

  it('links an event task to its event', async () => {
    const event = await createEvent(db, {
      seasonId, name: 'מסיבת פקאנים', kind: 'fundraiser',
    });
    await createTask(db, {
      seasonId, eventId: event.id, kind: 'event_task', title: 'כניסה', peopleNeeded: 2,
    });
    const [task] = await listTasks(db, seasonId);
    expect(task.eventName).toBe('מסיבת פקאנים');
  });

  it('closes a task', async () => {
    await createTask(db, { seasonId, kind: 'build', title: 'סידור מחסן' });
    const [task] = await listTasks(db, seasonId);
    await setTaskStatus(db, task.taskId, 'done');
    expect((await listTasks(db, seasonId))[0].status).toBe('done');
  });
});
