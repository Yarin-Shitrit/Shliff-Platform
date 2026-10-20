import { asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank, normalizeHebrew } from '@/lib/text/normalize';
import { seasons, tasks, type AssignmentStatus, type TaskStatus } from '@/db/schema/camp';
import { shiftSlots, shiftTypes } from '@/db/schema/logistics';
import { createTask, setTaskStatus } from '@/lib/work/tasks';
import {
  assignPerson, coverageFor, removeAssignment, rosterWorkload,
  type Assignee,
} from '@/lib/work/coverage';
import {
  campDayOf, campInstant, clockMinutes, eventWindow, isCivilDay, minutesBetween,
  parseClock, type Clock, type EventWindow,
} from './shift-time';

/**
 * The shift schedule: types, slots, and who is on them.
 *
 * The slots are not this module's rows. A scheduled shift is a `tasks` row
 * of kind `shift`, written through `createTask` and read through
 * `coverageFor` — the same functions the משימות board uses — so that board,
 * the coverage report, the sidebar's understaffed count and a person's own
 * page all see the schedule without being told about it. What this module
 * owns is the *type* a slot was made from (`shift_slots`) and the types
 * themselves (`shift_types`).
 *
 * Someone put on a shift here is `accepted` at once, not `proposed`. The
 * board's rule is that only an accepted assignment counts as cover, and a
 * lead filling a printed schedule is placing people, not floating a
 * suggestion — a sheet of names that the coverage tile then counts as zero
 * would be two screens disagreeing about the same fact.
 */

export interface ShiftTypeInput {
  name: string;
  /** `HH:MM`. */
  startsClock: string;
  /** `HH:MM`. Earlier than or equal to the start means the next day. */
  endsClock: string;
  peopleNeeded: number;
  notes: string | null;
}

export interface ShiftType {
  id: string;
  name: string;
  startsClock: string;
  endsClock: string;
  peopleNeeded: number;
  notes: string | null;
  retiredAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

function validateType(input: ShiftTypeInput): { starts: Clock; ends: Clock } {
  if (isBlank(input.name)) throw new Error('a shift type needs a name');
  const starts = parseClock(input.startsClock);
  const ends = parseClock(input.endsClock);
  if (!starts || !ends) throw new Error('a shift type needs a start and an end clock');
  if (!Number.isInteger(input.peopleNeeded) || input.peopleNeeded < 1) {
    throw new Error('a shift type needs at least one person');
  }
  return { starts, ends };
}

/**
 * Two active types with one name would be two rows on the schedule that
 * read the same, and the camp would staff one and print the other.
 * Compared normalised, so `בר` and ` בר ` are the same type. A retired type
 * does not hold its name: the camp may start running `שער` again.
 */
async function refuseDuplicateName(db: AnyDb, name: string, exceptId: string | null): Promise<void> {
  const wanted = normalizeHebrew(name);
  const active = await db.select({ id: shiftTypes.id, name: shiftTypes.name })
    .from(shiftTypes).where(isNull(shiftTypes.retiredAt));
  const taken = active.some((row) => row.id !== exceptId && normalizeHebrew(row.name) === wanted);
  if (taken) throw new Error('a shift type with that name already exists');
}

export async function createShiftType(db: AnyDb, input: ShiftTypeInput, email: string): Promise<string> {
  validateType(input);
  await refuseDuplicateName(db, input.name, null);
  const [row] = await db.insert(shiftTypes).values({
    name: input.name.trim(),
    startsClock: input.startsClock.trim(),
    endsClock: input.endsClock.trim(),
    peopleNeeded: input.peopleNeeded,
    notes: input.notes && !isBlank(input.notes) ? input.notes.trim() : null,
    updatedBy: email,
  }).returning();
  return row.id;
}

export async function updateShiftType(
  db: AnyDb, id: string, input: ShiftTypeInput, email: string,
): Promise<void> {
  validateType(input);
  if (!(await shiftTypeById(db, id))) throw new Error(`unknown shift type ${id}`);
  await refuseDuplicateName(db, input.name, id);
  await db.update(shiftTypes).set({
    name: input.name.trim(),
    startsClock: input.startsClock.trim(),
    endsClock: input.endsClock.trim(),
    peopleNeeded: input.peopleNeeded,
    notes: input.notes && !isBlank(input.notes) ? input.notes.trim() : null,
    updatedAt: new Date(),
    updatedBy: email,
  }).where(eq(shiftTypes.id, id));
}

/** Retires or restores. Nothing is deleted; the slots keep their type. */
export async function setShiftTypeRetired(
  db: AnyDb, id: string, retired: boolean, email: string,
): Promise<void> {
  const type = await shiftTypeById(db, id);
  if (!type) throw new Error(`unknown shift type ${id}`);
  if (!retired) await refuseDuplicateName(db, type.name, id);
  await db.update(shiftTypes).set({
    retiredAt: retired ? new Date() : null,
    updatedAt: new Date(),
    updatedBy: email,
  }).where(eq(shiftTypes.id, id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function shiftTypeById(db: AnyDb, id: string): Promise<ShiftType | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(shiftTypes).where(eq(shiftTypes.id, id));
  return row ?? null;
}

/** Every type, active first, then by name. Retired ones are listed so the
 *  schedule can still name them and a lead can bring one back. */
export async function listShiftTypes(db: AnyDb): Promise<ShiftType[]> {
  const rows = await db.select().from(shiftTypes).orderBy(asc(shiftTypes.name));
  return [...rows].sort((a, b) => Number(a.retiredAt !== null) - Number(b.retiredAt !== null));
}

export interface ScheduleInput {
  seasonId: string;
  shiftTypeId: string;
  /** `YYYY-MM-DD`, each inside the event. One slot is made per day. */
  days: string[];
  startsClock: string;
  endsClock: string;
  peopleNeeded: number;
}

/**
 * The instant pair a clock pair means on a given day. An end clock at or
 * before the start clock is the next morning — `22:00–02:00` is a four-hour
 * night shift, not a refusal.
 */
export function slotInstants(day: string, starts: Clock, ends: Clock): { startsAt: Date; endsAt: Date } {
  const startsAt = campInstant(day, starts);
  const sameDay = clockMinutes(ends) > clockMinutes(starts);
  const endsAt = sameDay ? campInstant(day, ends) : new Date(campInstant(day, ends).getTime() + 86_400_000);
  return { startsAt, endsAt };
}

function refuseOutsideWindow(window: EventWindow, startsAt: Date, endsAt: Date): void {
  if (startsAt < window.startsAt || endsAt > window.endsAt) {
    throw new Error('a shift lies outside the event window');
  }
}

/**
 * Puts a type on the schedule for one or more days.
 *
 * Each day becomes one task with its own copy of the window and the
 * head-count — the type is only what the drawer pre-filled. A day outside
 * the event, or a window that reaches past its edges, is refused: the camp
 * stated when the event is, and a slot the schedule cannot show would be a
 * shift nobody sees until the person page lists it.
 *
 * Returns the task ids made, in day order, so the screen can open the first.
 */
export async function scheduleShifts(
  db: AnyDb, input: ScheduleInput, window: EventWindow,
): Promise<string[]> {
  const type = await shiftTypeById(db, input.shiftTypeId);
  if (!type) throw new Error(`unknown shift type ${input.shiftTypeId}`);
  if (type.retiredAt !== null) throw new Error('that shift type was retired');
  const starts = parseClock(input.startsClock);
  const ends = parseClock(input.endsClock);
  if (!starts || !ends) throw new Error('a shift needs a start and an end clock');
  if (!Number.isInteger(input.peopleNeeded) || input.peopleNeeded < 1) {
    throw new Error('a task needs at least one person');
  }
  const days = [...new Set(input.days.map((day) => day.trim()))].sort();
  if (days.length === 0) throw new Error('a shift needs at least one day');
  const eventDays = new Set(window.days.map((day) => day.day));
  for (const day of days) {
    if (!isCivilDay(day) || !eventDays.has(day)) throw new Error('a shift lies outside the event window');
  }

  const made: string[] = [];
  for (const day of days) {
    const { startsAt, endsAt } = slotInstants(day, starts, ends);
    refuseOutsideWindow(window, startsAt, endsAt);
    const taskId = await createTask(db, {
      seasonId: input.seasonId,
      kind: 'shift',
      title: type.name,
      startsAt,
      endsAt,
      peopleNeeded: input.peopleNeeded,
    });
    await db.insert(shiftSlots).values({ taskId, shiftTypeId: type.id });
    made.push(taskId);
  }
  return made;
}

export interface SlotUpdate {
  startsClock: string;
  endsClock: string;
  peopleNeeded: number;
}

/**
 * Changes one slot's window or head-count. The day stays the one it was
 * scheduled on; moving a shift to another day is a new slot and a cancelled
 * one, so the history says what happened.
 */
export async function updateShiftSlot(
  db: AnyDb, taskId: string, input: SlotUpdate, window: EventWindow,
): Promise<void> {
  const slot = await slotTask(db, taskId);
  if (!slot) throw new Error(`unknown shift ${taskId}`);
  const starts = parseClock(input.startsClock);
  const ends = parseClock(input.endsClock);
  if (!starts || !ends) throw new Error('a shift needs a start and an end clock');
  if (!Number.isInteger(input.peopleNeeded) || input.peopleNeeded < 1) {
    throw new Error('a task needs at least one person');
  }
  const { startsAt, endsAt } = slotInstants(campDayOf(slot.startsAt), starts, ends);
  refuseOutsideWindow(window, startsAt, endsAt);
  await db.update(tasks)
    .set({ startsAt, endsAt, peopleNeeded: input.peopleNeeded })
    .where(eq(tasks.id, taskId));
}

/** A cancelled shift leaves the schedule and keeps its row, as every task does. */
export async function cancelShiftSlot(db: AnyDb, taskId: string): Promise<void> {
  if (!(await slotTask(db, taskId))) throw new Error(`unknown shift ${taskId}`);
  await setTaskStatus(db, taskId, 'cancelled');
}

async function slotTask(db: AnyDb, taskId: string): Promise<{ startsAt: Date } | null> {
  if (!UUID.test(taskId)) return null;
  const [row] = await db.select({ startsAt: tasks.startsAt, kind: tasks.kind })
    .from(tasks).where(eq(tasks.id, taskId));
  if (!row || row.kind !== 'shift' || row.startsAt === null) return null;
  return { startsAt: row.startsAt };
}

/**
 * Puts people on a shift. Several at once, as the board does, and for the
 * same reason: a failure part-way does not undo the names that landed. The
 * failures come back as thrown messages the action maps to Hebrew.
 */
export async function assignToShift(
  db: AnyDb, taskId: string, personIds: string[], email: string,
): Promise<{ failures: unknown[] }> {
  if (!(await slotTask(db, taskId))) throw new Error(`unknown shift ${taskId}`);
  const failures: unknown[] = [];
  for (const personId of personIds) {
    try {
      await assignPerson(db, taskId, personId, email, 'accepted');
    } catch (error) {
      failures.push(error);
    }
  }
  return { failures };
}

export async function unassignFromShift(db: AnyDb, assignmentId: string): Promise<void> {
  await removeAssignment(db, assignmentId);
}

export interface ScheduleSlot {
  taskId: string;
  /** Null for a shift made on the משימות board, which knows no types. */
  typeId: string | null;
  /** The type's name, or the task's own title when it has no type. */
  title: string;
  startsAt: Date;
  endsAt: Date;
  peopleNeeded: number;
  accepted: number;
  uncovered: boolean;
  status: TaskStatus;
  assignees: Assignee[];
}

/**
 * Every open shift of the season, with its type. Read through `coverageFor`
 * so the people on it are the people the board shows. Cancelled shifts are
 * left out — they are history, and the board's own view carries them.
 * A shift the board created with no window cannot be placed and is dropped
 * here; `coverageFor` still lists it under משימות as undated.
 */
export async function listSchedule(db: AnyDb, seasonId: string): Promise<ScheduleSlot[]> {
  const coverage = (await coverageFor(db, seasonId)).filter((row) =>
    row.kind === 'shift' && row.status !== 'cancelled'
    && row.startsAt !== null && row.endsAt !== null);
  if (coverage.length === 0) return [];

  const slots = await db.select({ taskId: shiftSlots.taskId, typeId: shiftSlots.shiftTypeId, typeName: shiftTypes.name })
    .from(shiftSlots)
    .innerJoin(shiftTypes, eq(shiftTypes.id, shiftSlots.shiftTypeId))
    .where(inArray(shiftSlots.taskId, coverage.map((row) => row.taskId)));
  const typeOf = new Map(slots.map((slot) => [slot.taskId, slot]));

  return coverage
    .map((row) => {
      const slot = typeOf.get(row.taskId) ?? null;
      return {
        taskId: row.taskId,
        typeId: slot?.typeId ?? null,
        title: slot?.typeName ?? row.title,
        startsAt: row.startsAt!,
        endsAt: row.endsAt!,
        peopleNeeded: row.peopleNeeded,
        accepted: row.accepted,
        uncovered: row.uncovered,
        status: row.status,
        assignees: row.assignees,
      };
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title, 'he'));
}

export interface BoardRow {
  /** Null is the row for shifts that have no type. */
  type: { id: string; name: string; retired: boolean } | null;
  /** One list per event day, in day order; overlapping shifts simply share a list. */
  cells: ScheduleSlot[][];
}

export interface Board {
  rows: BoardRow[];
  /** Shifts whose start falls on none of the event's days. */
  outside: ScheduleSlot[];
}

/**
 * The schedule as a grid: one row per type, one column per day. Pure, so
 * the screen and the printed sheet lay out the same board from the same
 * rows. Active types get a row whether or not they hold anything — an empty
 * cell is the invitation to schedule. A retired type gets a row only while
 * it still holds a slot; a shift with no type gets the last row, and only
 * if there is one.
 */
export function buildBoard(slots: ScheduleSlot[], types: ShiftType[], window: EventWindow): Board {
  const column = new Map(window.days.map((day) => [day.day, day.index]));
  const emptyCells = (): ScheduleSlot[][] => window.days.map(() => []);

  const rows = new Map<string | null, BoardRow>();
  for (const type of types) {
    if (type.retiredAt === null) {
      rows.set(type.id, { type: { id: type.id, name: type.name, retired: false }, cells: emptyCells() });
    }
  }

  const outside: ScheduleSlot[] = [];
  for (const slot of slots) {
    const index = column.get(campDayOf(slot.startsAt));
    if (index === undefined) { outside.push(slot); continue; }
    let row = rows.get(slot.typeId);
    if (!row) {
      const type = slot.typeId === null ? null
        : types.find((candidate) => candidate.id === slot.typeId);
      row = {
        type: slot.typeId === null || !type ? null
          : { id: type.id, name: type.name, retired: type.retiredAt !== null },
        cells: emptyCells(),
      };
      rows.set(slot.typeId, row);
    }
    row.cells[index].push(slot);
  }

  const ordered = [...rows.values()].sort((a, b) => {
    if (a.type === null) return 1;
    if (b.type === null) return -1;
    return Number(a.type.retired) - Number(b.type.retired) || a.type.name.localeCompare(b.type.name, 'he');
  });
  return { rows: ordered, outside };
}

export interface PersonLoad {
  personId: string;
  displayName: string;
  shifts: number;
  minutes: number;
}

/**
 * How much each person on the roster carries, from the slots on screen.
 * Every member of the season is listed, with zero when they hold nothing —
 * who is free is the question a lead asks the list, and a person missing
 * from it reads as "not in the camp" rather than "not yet placed".
 */
export function personLoad(
  slots: ScheduleSlot[],
  roster: ReadonlyArray<{ personId: string; displayName: string }>,
): PersonLoad[] {
  const load = new Map<string, PersonLoad>();
  for (const member of roster) {
    load.set(member.personId, { ...member, shifts: 0, minutes: 0 });
  }
  for (const slot of slots) {
    const minutes = minutesBetween(slot.startsAt, slot.endsAt);
    for (const assignee of slot.assignees) {
      if (!counts(assignee.status)) continue;
      const entry = load.get(assignee.personId)
        ?? { personId: assignee.personId, displayName: assignee.displayName, shifts: 0, minutes: 0 };
      entry.shifts += 1;
      entry.minutes += minutes;
      load.set(assignee.personId, entry);
    }
  }
  return [...load.values()].sort((a, b) =>
    b.minutes - a.minutes || b.shifts - a.shifts || a.displayName.localeCompare(b.displayName, 'he'));
}

/** The board's own rule, restated once: only an accepted or done assignment is cover. */
function counts(status: AssignmentStatus): boolean {
  return status === 'accepted' || status === 'done';
}

export interface ScheduleTotals {
  slots: number;
  uncoveredSlots: number;
  placesNeeded: number;
  placesFilled: number;
}

/** `12 מתוך 30 מקומות`, capped per slot as the board caps it. */
export function summarizeSchedule(slots: ScheduleSlot[]): ScheduleTotals {
  return {
    slots: slots.length,
    uncoveredSlots: slots.filter((slot) => slot.uncovered).length,
    placesNeeded: slots.reduce((sum, slot) => sum + slot.peopleNeeded, 0),
    placesFilled: slots.reduce((sum, slot) => sum + Math.min(slot.accepted, slot.peopleNeeded), 0),
  };
}

export interface RosterOption {
  personId: string;
  displayName: string;
  shifts: number;
  minutes: number;
}

/**
 * Who may be put on a shift: the season's roster, each with the load they
 * already carry on this schedule, lightest first. `rosterWorkload` is the
 * board's own roster query, and is reused for its membership and its
 * merged-person rule; only the load is recounted, in shifts and hours rather
 * than in tasks of every kind.
 */
export async function shiftRoster(db: AnyDb, seasonId: string, slots: ScheduleSlot[]): Promise<RosterOption[]> {
  const roster = await rosterWorkload(db, seasonId);
  const load = new Map(personLoad(slots, roster).map((entry) => [entry.personId, entry]));
  return roster
    .map((member) => {
      const entry = load.get(member.personId);
      return { ...member, shifts: entry?.shifts ?? 0, minutes: entry?.minutes ?? 0 };
    })
    .sort((a, b) => a.minutes - b.minutes || a.shifts - b.shifts || a.displayName.localeCompare(b.displayName, 'he'));
}

/** The window for a season, or null when the season has no gate date yet. */
export function windowFor(startsOn: Date | null): EventWindow | null {
  return startsOn === null ? null : eventWindow(startsOn);
}

/**
 * The window a write must respect, from the season's own row. Thrown rather
 * than null: an action that reaches here with an undated season has a form
 * open over a schedule the page refused to draw, and the lead is owed a
 * sentence about why nothing was saved.
 */
export async function seasonWindow(db: AnyDb, seasonId: string): Promise<EventWindow> {
  if (!UUID.test(seasonId)) throw new Error(`unknown season ${seasonId}`);
  const [season] = await db.select({ startsOn: seasons.startsOn })
    .from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);
  const window = windowFor(season.startsOn);
  if (!window) throw new Error('the season has no gate date');
  return window;
}
