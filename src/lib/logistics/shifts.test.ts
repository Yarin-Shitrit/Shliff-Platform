import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '@/test/db';
import { persons, seasons, tasks, taskAssignments } from '@/db/schema/camp';
import { shiftSlots } from '@/db/schema/logistics';
import { addMember } from '@/lib/members/roster';
import { createTask } from '@/lib/work/tasks';
import { coverageFor } from '@/lib/work/coverage';
import {
  createShiftType, updateShiftType, setShiftTypeRetired, listShiftTypes, shiftTypeById,
  scheduleShifts, updateShiftSlot, cancelShiftSlot, assignToShift, unassignFromShift,
  listSchedule, buildBoard, personLoad, summarizeSchedule, shiftRoster, seasonWindow,
  slotInstants, type ScheduleSlot, type ShiftType,
} from './shifts';
import { campInstant, eventWindow, parseClock } from './shift-time';

const LEAD = 'lead@shliff.camp';
const GATE = new Date('2026-06-08T00:00:00Z');
const WINDOW = eventWindow(GATE);

const BAR = { name: 'בר', startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2, notes: null };
const GATE_SHIFT = { name: 'שער', startsClock: '16:00', endsClock: '20:00', peopleNeeded: 1, notes: null };

describe('shift types', () => {
  let db: TestDb;

  beforeEach(async () => { db = await createTestDb(); });

  it('stores a type with its usual window and head-count, and who wrote it', async () => {
    const id = await createShiftType(db, { ...BAR, name: '  בר ' }, LEAD);
    const type = await shiftTypeById(db, id);
    expect(type?.name).toBe('בר');
    expect(type?.startsClock).toBe('20:00');
    expect(type?.peopleNeeded).toBe(2);
    expect(type?.updatedBy).toBe(LEAD);
    expect(type?.retiredAt).toBeNull();
  });

  it('refuses a nameless type, a bad clock, and no people', async () => {
    await expect(createShiftType(db, { ...BAR, name: ' ' }, LEAD)).rejects.toThrow(/name/);
    await expect(createShiftType(db, { ...BAR, endsClock: '8pm' }, LEAD)).rejects.toThrow(/clock/);
    await expect(createShiftType(db, { ...BAR, peopleNeeded: 0 }, LEAD)).rejects.toThrow(/at least one person/);
  });

  it('refuses a second active type with the same name, however it is spaced', async () => {
    await createShiftType(db, BAR, LEAD);
    await expect(createShiftType(db, { ...BAR, name: ' בר  ' }, LEAD)).rejects.toThrow(/already exists/);
  });

  it('lets a retired name be used again, and refuses to restore it while it is taken', async () => {
    const old = await createShiftType(db, BAR, LEAD);
    await setShiftTypeRetired(db, old, true, LEAD);
    expect((await shiftTypeById(db, old))?.retiredAt).not.toBeNull();
    await createShiftType(db, BAR, LEAD);
    await expect(setShiftTypeRetired(db, old, false, LEAD)).rejects.toThrow(/already exists/);
  });

  it('lists active types first, then retired, by name', async () => {
    const gate = await createShiftType(db, GATE_SHIFT, LEAD);
    await createShiftType(db, BAR, LEAD);
    await createShiftType(db, { ...BAR, name: 'מטבח' }, LEAD);
    await setShiftTypeRetired(db, gate, true, LEAD);
    expect((await listShiftTypes(db)).map((type) => type.name)).toEqual(['בר', 'מטבח', 'שער']);
  });

  it('edits in place and keeps the id', async () => {
    const id = await createShiftType(db, BAR, LEAD);
    await updateShiftType(db, id, { ...BAR, peopleNeeded: 3, notes: ' לנעול את המקרר ' }, 'other@shliff.camp');
    const type = await shiftTypeById(db, id);
    expect(type?.peopleNeeded).toBe(3);
    expect(type?.notes).toBe('לנעול את המקרר');
    expect(type?.updatedBy).toBe('other@shliff.camp');
  });

  it('answers null for an id that is not one', async () => {
    expect(await shiftTypeById(db, 'not-a-uuid')).toBeNull();
  });
});

describe('slot instants', () => {
  it('puts an end clock at or before the start on the next day', () => {
    const night = slotInstants('2026-06-08', parseClock('22:00')!, parseClock('02:00')!);
    expect(night.startsAt.toISOString()).toBe('2026-06-08T19:00:00.000Z');
    expect(night.endsAt.toISOString()).toBe('2026-06-09T23:00:00.000Z'.replace('23:00', '23:00').replace('2026-06-09T23', '2026-06-08T23'));
    const day = slotInstants('2026-06-08', parseClock('16:00')!, parseClock('20:00')!);
    expect(day.endsAt.getTime() - day.startsAt.getTime()).toBe(4 * 3_600_000);
  });
});

describe('the schedule against a real database', () => {
  let db: TestDb;
  let seasonId: string;
  let barId: string;
  let ofek: string;
  let noa: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [season] = await db.insert(seasons)
      .values({ name: 'ברן 26', year: 2026, flatRate: '1200.00', startsOn: GATE }).returning();
    seasonId = season.id;
    barId = await createShiftType(db, BAR, LEAD);
    const [a] = await db.insert(persons).values({ displayName: 'אופק' }).returning();
    const [b] = await db.insert(persons).values({ displayName: 'נועה' }).returning();
    ofek = a.id; noa = b.id;
    await addMember(db, ofek, seasonId);
    await addMember(db, noa, seasonId);
  });

  it('makes one shift task per day, each carrying its own window and count', async () => {
    const made = await scheduleShifts(db, {
      seasonId, shiftTypeId: barId, days: ['2026-06-09', '2026-06-08'],
      startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
    }, WINDOW);
    expect(made).toHaveLength(2);

    const rows = await listSchedule(db, seasonId);
    expect(rows.map((row) => row.title)).toEqual(['בר', 'בר']);
    expect(rows[0].startsAt.toISOString()).toBe('2026-06-08T17:00:00.000Z');
    expect(rows[0].endsAt.toISOString()).toBe('2026-06-08T21:00:00.000Z');
    expect(rows[0].typeId).toBe(barId);
    expect(rows[0].peopleNeeded).toBe(2);
    expect(rows[0].uncovered).toBe(true);

    // The board under משימות sees exactly the same two shifts.
    const board = await coverageFor(db, seasonId);
    expect(board.filter((task) => task.kind === 'shift')).toHaveLength(2);
  });

  it('refuses a day outside the event, and a window that reaches past its edges', async () => {
    const base = { seasonId, shiftTypeId: barId, startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2 };
    await expect(scheduleShifts(db, { ...base, days: ['2026-06-14'] }, WINDOW))
      .rejects.toThrow(/outside the event window/);
    // Monday at noon is before the gate opens at 16:00.
    await expect(scheduleShifts(db, { ...base, days: ['2026-06-08'], startsClock: '12:00', endsClock: '14:00' }, WINDOW))
      .rejects.toThrow(/outside the event window/);
    // A Saturday shift ending at 14:00 runs past noon.
    await expect(scheduleShifts(db, { ...base, days: ['2026-06-13'], startsClock: '10:00', endsClock: '14:00' }, WINDOW))
      .rejects.toThrow(/outside the event window/);
    await expect(scheduleShifts(db, { ...base, days: [] }, WINDOW)).rejects.toThrow(/at least one day/);
    expect(await listSchedule(db, seasonId)).toEqual([]);
  });

  it('refuses a retired type and a type that does not exist', async () => {
    await setShiftTypeRetired(db, barId, true, LEAD);
    const base = { seasonId, days: ['2026-06-08'], startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2 };
    await expect(scheduleShifts(db, { ...base, shiftTypeId: barId }, WINDOW)).rejects.toThrow(/retired/);
    await expect(scheduleShifts(db, { ...base, shiftTypeId: 'nope' }, WINDOW)).rejects.toThrow(/unknown shift type/);
  });

  it('places people as accepted, so the coverage count agrees with the sheet', async () => {
    const [taskId] = await scheduleShifts(db, {
      seasonId, shiftTypeId: barId, days: ['2026-06-08'], startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
    }, WINDOW);
    const { failures } = await assignToShift(db, taskId, [ofek, noa], LEAD);
    expect(failures).toEqual([]);

    const [row] = await listSchedule(db, seasonId);
    expect(row.accepted).toBe(2);
    expect(row.uncovered).toBe(false);
    expect(row.assignees.map((one) => one.status)).toEqual(['accepted', 'accepted']);

    // A second placing of the same person is one failure, and the other lands.
    const again = await assignToShift(db, taskId, [ofek], LEAD);
    expect(again.failures).toHaveLength(1);

    await unassignFromShift(db, row.assignees[0].assignmentId);
    expect((await listSchedule(db, seasonId))[0].accepted).toBe(1);
  });

  it('edits a slot window on its own day, and refuses one that leaves the event', async () => {
    const [taskId] = await scheduleShifts(db, {
      seasonId, shiftTypeId: barId, days: ['2026-06-13'], startsClock: '08:00', endsClock: '10:00', peopleNeeded: 2,
    }, WINDOW);
    await updateShiftSlot(db, taskId, { startsClock: '09:00', endsClock: '12:00', peopleNeeded: 3 }, WINDOW);
    const [row] = await listSchedule(db, seasonId);
    expect(row.startsAt).toEqual(campInstant('2026-06-13', { hours: 9, minutes: 0 }));
    expect(row.peopleNeeded).toBe(3);
    await expect(updateShiftSlot(db, taskId, { startsClock: '11:00', endsClock: '13:00', peopleNeeded: 3 }, WINDOW))
      .rejects.toThrow(/outside the event window/);
    await expect(updateShiftSlot(db, 'nope', { startsClock: '11:00', endsClock: '12:00', peopleNeeded: 3 }, WINDOW))
      .rejects.toThrow(/unknown shift/);
  });

  it('cancels a slot without deleting it', async () => {
    const [taskId] = await scheduleShifts(db, {
      seasonId, shiftTypeId: barId, days: ['2026-06-08'], startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
    }, WINDOW);
    await cancelShiftSlot(db, taskId);
    expect(await listSchedule(db, seasonId)).toEqual([]);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.status).toBe('cancelled');
    expect(await db.select().from(shiftSlots)).toHaveLength(1);
  });

  it('shows a shift the משימות board made with no type, and drops one with no window', async () => {
    await createTask(db, {
      seasonId, kind: 'shift', title: 'ניקיון',
      startsAt: campInstant('2026-06-10', { hours: 9, minutes: 0 }),
      endsAt: campInstant('2026-06-10', { hours: 11, minutes: 0 }),
    });
    await db.insert(tasks).values({ seasonId, kind: 'shift', title: 'בלי שעה' });
    await createTask(db, { seasonId, kind: 'build', title: 'ספסלים' });
    const rows = await listSchedule(db, seasonId);
    expect(rows.map((row) => [row.title, row.typeId])).toEqual([['ניקיון', null]]);
  });

  it('counts each member\'s load and lists the roster lightest first', async () => {
    const [monday, tuesday] = await scheduleShifts(db, {
      seasonId, shiftTypeId: barId, days: ['2026-06-08', '2026-06-09'],
      startsClock: '20:00', endsClock: '00:00', peopleNeeded: 1,
    }, WINDOW);
    await assignToShift(db, monday, [ofek], LEAD);
    await assignToShift(db, tuesday, [ofek], LEAD);
    const slots = await listSchedule(db, seasonId);
    const roster = await shiftRoster(db, seasonId, slots);
    expect(roster.map((member) => [member.displayName, member.shifts, member.minutes]))
      .toEqual([['נועה', 0, 0], ['אופק', 2, 480]]);
  });

  it('ignores a proposed assignment in the load, as the board does in cover', async () => {
    const [taskId] = await scheduleShifts(db, {
      seasonId, shiftTypeId: barId, days: ['2026-06-08'], startsClock: '20:00', endsClock: '00:00', peopleNeeded: 1,
    }, WINDOW);
    await db.insert(taskAssignments).values({ taskId, personId: noa, status: 'proposed', assignedBy: LEAD });
    const slots = await listSchedule(db, seasonId);
    expect(slots[0].accepted).toBe(0);
    const load = personLoad(slots, [{ personId: noa, displayName: 'נועה' }]);
    expect(load[0].shifts).toBe(0);
  });

  it('reads the window off the season, and refuses an undated one', async () => {
    expect((await seasonWindow(db, seasonId)).startsAt).toEqual(WINDOW.startsAt);
    await db.update(seasons).set({ startsOn: null }).where(eq(seasons.id, seasonId));
    await expect(seasonWindow(db, seasonId)).rejects.toThrow(/no gate date/);
    await expect(seasonWindow(db, 'nope')).rejects.toThrow(/unknown season/);
  });
});

describe('the board, as pure arithmetic', () => {
  const bar: ShiftType = {
    id: 'bar', name: 'בר', startsClock: '20:00', endsClock: '00:00', peopleNeeded: 2,
    notes: null, retiredAt: null, updatedAt: new Date(), updatedBy: null,
  };
  const gate: ShiftType = { ...bar, id: 'gate', name: 'שער', retiredAt: new Date() };

  function slot(over: Partial<ScheduleSlot>): ScheduleSlot {
    return {
      taskId: 't', typeId: 'bar', title: 'בר',
      startsAt: campInstant('2026-06-08', { hours: 20, minutes: 0 }),
      endsAt: campInstant('2026-06-09', { hours: 0, minutes: 0 }),
      peopleNeeded: 2, accepted: 0, uncovered: true, status: 'open', assignees: [],
      ...over,
    };
  }

  it('gives every active type a row, a retired one only while it holds a slot', () => {
    const empty = buildBoard([], [bar, gate], WINDOW);
    expect(empty.rows.map((row) => row.type?.name)).toEqual(['בר']);
    expect(empty.rows[0].cells).toHaveLength(6);

    const held = buildBoard([slot({ taskId: 'g', typeId: 'gate', title: 'שער' })], [bar, gate], WINDOW);
    expect(held.rows.map((row) => [row.type?.name, row.type?.retired])).toEqual([['בר', false], ['שער', true]]);
  });

  it('puts two shifts of one kind on one day in the same cell, overlapping or not', () => {
    const board = buildBoard([
      slot({ taskId: 'a' }),
      slot({ taskId: 'b', startsAt: campInstant('2026-06-08', { hours: 22, minutes: 0 }) }),
      slot({ taskId: 'c', startsAt: campInstant('2026-06-09', { hours: 20, minutes: 0 }) }),
    ], [bar], WINDOW);
    expect(board.rows[0].cells.map((cell) => cell.length)).toEqual([2, 1, 0, 0, 0, 0]);
  });

  it('lists a typeless shift last, and a shift off the event days separately', () => {
    const board = buildBoard([
      slot({ taskId: 'x', typeId: null, title: 'ניקיון' }),
      slot({ taskId: 'y', startsAt: campInstant('2026-06-20', { hours: 9, minutes: 0 }) }),
    ], [bar], WINDOW);
    expect(board.rows.map((row) => row.type?.name ?? null)).toEqual(['בר', null]);
    expect(board.outside.map((one) => one.taskId)).toEqual(['y']);
  });

  it('sums places capped per slot, and counts the uncovered', () => {
    const totals = summarizeSchedule([
      slot({ accepted: 3, peopleNeeded: 2, uncovered: false }),
      slot({ accepted: 1, peopleNeeded: 2 }),
    ]);
    expect(totals).toEqual({ slots: 2, uncoveredSlots: 1, placesNeeded: 4, placesFilled: 3 });
  });
});
