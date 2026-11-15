import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyDb } from '@/lib/db-types';
import { isBlank } from '@/lib/text/normalize';
import { memberships, persons, seasons } from '@/db/schema/camp';
import { attendanceEvents, attendanceMarks, type AttendanceKind } from '@/db/schema/logistics';
import { isCivilDay } from './shift-time';
import { ATTENDANCE_KIND_LABELS } from './labels';

/**
 * נוכחות — the days the camp did something together before the burn, and
 * who was there.
 *
 * An occasion is a day with a kind (a work day, a build day, a shopping
 * run, a meeting) and, when the kind is not enough, a title. A mark is one
 * person at one occasion. The board is the roster against the occasions,
 * a check where a mark exists, and a count at the end of every row — which
 * is the question this screen exists to answer: who carried the year, and
 * how much.
 *
 * Everything here is one season's. Nothing here deletes: a wrong occasion
 * is cancelled and keeps its marks, and a mark is taken back by the lead
 * who can see it, never by a cascade they cannot.
 *
 * English throws, on purpose: `src/lib` speaks to whoever reads a stack
 * trace, and the Hebrew a lead sees is mapped at the action boundary by
 * `failure-messages.ts` (R9). Every message is a stable prefix that file
 * keys on.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ATTENDANCE_KINDS: readonly AttendanceKind[] = [
  'work_day', 'build_day', 'shopping', 'meeting', 'other',
];

// ── Occasions ───────────────────────────────────────────────────────────

export interface AttendanceEvent {
  id: string;
  seasonId: string;
  kind: AttendanceKind;
  /** `YYYY-MM-DD`, a civil day in the camp's zone. */
  heldOn: string;
  title: string | null;
  notes: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  /** How many people are marked present. Zero on a fresh occasion. */
  presentCount: number;
}

/**
 * What the drawer sends, in both of its modes. Every field is present every
 * time: a missing field on a create and a missing field on an edit would
 * mean two different things, and the library would have to guess which.
 */
export interface EventInput {
  kind: AttendanceKind;
  heldOn: string;
  title: string | null;
  notes: string | null;
}

const PRESENT = sql<number>`count(${attendanceMarks.id})`;

function eventsQuery(db: AnyDb) {
  return db
    .select({
      id: attendanceEvents.id,
      seasonId: attendanceEvents.seasonId,
      kind: attendanceEvents.kind,
      heldOn: attendanceEvents.heldOn,
      title: attendanceEvents.title,
      notes: attendanceEvents.notes,
      cancelledAt: attendanceEvents.cancelledAt,
      createdAt: attendanceEvents.createdAt,
      updatedAt: attendanceEvents.updatedAt,
      updatedBy: attendanceEvents.updatedBy,
      presentCount: PRESENT,
    })
    .from(attendanceEvents)
    .leftJoin(attendanceMarks, eq(attendanceMarks.eventId, attendanceEvents.id))
    .groupBy(attendanceEvents.id);
}

/* `count()` comes back from the driver as a string for a bigint, and a `'3'`
   rendered next to a `3` is invisible until somebody adds them. */
function shaped(row: Omit<AttendanceEvent, 'presentCount'> & { presentCount: unknown }): AttendanceEvent {
  return { ...row, presentCount: Number(row.presentCount) };
}

/**
 * Every occasion of the season, cancelled ones included, oldest day first.
 * The board decides what to draw; the list hides nothing, because a
 * cancelled occasion is still a row somebody made and may want back.
 *
 * Two occasions on one day keep the order they were entered in — the day is
 * text, so the tie-break is `created_at` rather than a guess at which of
 * two ״קניות״ came first.
 */
export async function listEvents(db: AnyDb, seasonId: string): Promise<AttendanceEvent[]> {
  const rows = await eventsQuery(db)
    .where(eq(attendanceEvents.seasonId, seasonId))
    .orderBy(asc(attendanceEvents.heldOn), asc(attendanceEvents.createdAt));
  return rows.map(shaped);
}

/** Null rather than a throw: the id comes from a URL someone may have edited. */
export async function eventById(db: AnyDb, id: string): Promise<AttendanceEvent | null> {
  if (!UUID.test(id)) return null;
  const [row] = await eventsQuery(db).where(eq(attendanceEvents.id, id)).limit(1);
  return row === undefined ? null : shaped(row);
}

function validate(input: EventInput): void {
  if (!ATTENDANCE_KINDS.includes(input.kind)) {
    throw new Error(`unknown attendance kind: ${String(input.kind)}`);
  }
  if (!isCivilDay(input.heldOn)) {
    // An occasion is a day. Without one there is nothing to put the marks
    // under, and `new Date('2026-02-30')` would quietly put them under March.
    throw new Error('an occasion needs a real day');
  }
}

function clean(input: EventInput) {
  return {
    kind: input.kind,
    heldOn: input.heldOn,
    title: input.title === null || isBlank(input.title) ? null : input.title.trim(),
    notes: input.notes === null || isBlank(input.notes) ? null : input.notes.trim(),
  };
}

async function requireSeason(db: AnyDb, seasonId: string): Promise<void> {
  if (!UUID.test(seasonId)) throw new Error(`unknown season ${seasonId}`);
  const [season] = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new Error(`unknown season ${seasonId}`);
}

/** Returns the new row's id, so the drawer can open over the occasion it just made. */
export async function createEvent(
  db: AnyDb, seasonId: string, input: EventInput, actor: string,
): Promise<string> {
  validate(input);
  await requireSeason(db, seasonId);
  const [row] = await db.insert(attendanceEvents)
    .values({ ...clean(input), seasonId, updatedBy: actor })
    .returning();
  return row.id;
}

/**
 * Checked before it writes: an `update` whose `where` matches nothing
 * succeeds and changes nothing, and the drawer would close on a save that
 * never happened.
 */
export async function updateEvent(
  db: AnyDb, id: string, input: EventInput, actor: string,
): Promise<void> {
  validate(input);
  if (!(await eventById(db, id))) throw new Error(`unknown occasion ${id}`);
  await db.update(attendanceEvents)
    .set({ ...clean(input), updatedBy: actor, updatedAt: new Date() })
    .where(eq(attendanceEvents.id, id));
}

/**
 * Cancels, or takes a cancellation back. The marks stay either way: a
 * cancelled occasion's marks stop counting on the board, and come back
 * counting the moment it is restored. Nothing anybody recorded is lost to
 * a lead changing their mind about a date.
 */
export async function setEventCancelled(
  db: AnyDb, id: string, cancelled: boolean, actor: string,
): Promise<void> {
  if (!(await eventById(db, id))) throw new Error(`unknown occasion ${id}`);
  await db.update(attendanceEvents)
    .set({ cancelledAt: cancelled ? new Date() : null, updatedBy: actor, updatedAt: new Date() })
    .where(eq(attendanceEvents.id, id));
}

// ── Marks ───────────────────────────────────────────────────────────────

export interface Mark {
  eventId: string;
  personId: string;
  /** Carried so the board can name a person who has since left the roster. */
  displayName: string;
  markedBy: string;
  createdAt: Date;
}

/** Every mark on every occasion of the season, cancelled occasions included. */
export async function listMarks(db: AnyDb, seasonId: string): Promise<Mark[]> {
  return db
    .select({
      eventId: attendanceMarks.eventId,
      personId: attendanceMarks.personId,
      displayName: persons.displayName,
      markedBy: attendanceMarks.markedBy,
      createdAt: attendanceMarks.createdAt,
    })
    .from(attendanceMarks)
    .innerJoin(attendanceEvents, eq(attendanceEvents.id, attendanceMarks.eventId))
    .innerJoin(persons, eq(persons.id, attendanceMarks.personId))
    .where(eq(attendanceEvents.seasonId, seasonId))
    .orderBy(asc(attendanceMarks.createdAt));
}

export interface RosterMember {
  personId: string;
  displayName: string;
}

/**
 * Who can be marked: the season's roster, by name, without anyone merged
 * away. A merged person is invisible everywhere else in the app, and a
 * check beside them would be a check beside a name that no longer exists.
 */
export async function attendanceRoster(db: AnyDb, seasonId: string): Promise<RosterMember[]> {
  return db
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(and(eq(memberships.seasonId, seasonId), isNull(persons.mergedIntoId)))
    .orderBy(asc(persons.displayName));
}

/**
 * Marks one person present at one occasion, or takes the mark back.
 * Idempotent in both directions: ticking a box that is ticked and clearing
 * one that is clear both succeed and change nothing, because two leads on
 * two phones will do exactly that.
 *
 * Refuses a person who is not on the season's roster rather than marking
 * them anyway: somebody who came to a work day and is not yet on the list
 * is a decision for אנשים, and a mark against a name the roster does not
 * show would be a figure nobody can find the page for.
 */
export async function setMark(
  db: AnyDb, eventId: string, personId: string, present: boolean, actor: string,
): Promise<void> {
  const event = await eventById(db, eventId);
  if (!event) throw new Error(`unknown occasion ${eventId}`);
  if (event.cancelledAt !== null) throw new Error('that occasion was cancelled');
  if (!UUID.test(personId)) throw new Error(`unknown person ${personId}`);

  const [member] = await db
    .select({ personId: persons.id })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(and(
      eq(memberships.seasonId, event.seasonId),
      eq(memberships.personId, personId),
      isNull(persons.mergedIntoId),
    ));
  if (!member) throw new Error('that person is not on this season roster');

  if (present) {
    await db.insert(attendanceMarks)
      .values({ eventId, personId, markedBy: actor })
      .onConflictDoNothing({ target: [attendanceMarks.eventId, attendanceMarks.personId] });
  } else {
    await db.delete(attendanceMarks)
      .where(and(eq(attendanceMarks.eventId, eventId), eq(attendanceMarks.personId, personId)));
  }
}

/** Marks on these occasions, for a drawer that shows one occasion's list. */
export async function marksOf(db: AnyDb, eventIds: readonly string[]): Promise<Mark[]> {
  if (eventIds.length === 0) return [];
  return db
    .select({
      eventId: attendanceMarks.eventId,
      personId: attendanceMarks.personId,
      displayName: persons.displayName,
      markedBy: attendanceMarks.markedBy,
      createdAt: attendanceMarks.createdAt,
    })
    .from(attendanceMarks)
    .innerJoin(persons, eq(persons.id, attendanceMarks.personId))
    .where(inArray(attendanceMarks.eventId, [...eventIds]))
    .orderBy(asc(persons.displayName));
}

// ── The board ───────────────────────────────────────────────────────────

export interface BoardRow {
  personId: string;
  displayName: string;
  /**
   * False for someone with a mark who is no longer on the season's roster.
   * They still have a row — a mark is a fact somebody recorded — and the
   * board says why the row is there instead of dropping it.
   */
  onRoster: boolean;
  /** The occasions this person is marked present at, by occasion id. */
  present: ReadonlySet<string>;
  /** How many live occasions they were at. The figure the year is read by. */
  total: number;
}

export interface Board {
  /** The occasions the board draws: not cancelled, oldest first. */
  events: AttendanceEvent[];
  /** Cancelled occasions, kept aside so the page can list them and offer them back. */
  cancelled: AttendanceEvent[];
  /** Roster first, by name; then anyone marked who has left the roster. */
  rows: BoardRow[];
  /** Present count per live occasion, by id. */
  perEvent: ReadonlyMap<string, number>;
}

/**
 * Pure: the roster against the occasions. Marks on a cancelled occasion
 * are kept out of every count — the occasion is out of the board, so its
 * marks are out of the figures, and come back when it does.
 */
export function buildBoard(
  events: readonly AttendanceEvent[],
  marks: readonly Mark[],
  roster: readonly RosterMember[],
): Board {
  const live = events.filter((event) => event.cancelledAt === null);
  const cancelled = events.filter((event) => event.cancelledAt !== null);
  const liveIds = new Set(live.map((event) => event.id));

  const presentBy = new Map<string, Set<string>>();
  const namesOff = new Map<string, string>();
  const perEvent = new Map<string, number>(live.map((event) => [event.id, 0]));
  const onRoster = new Set(roster.map((member) => member.personId));

  for (const mark of marks) {
    if (!liveIds.has(mark.eventId)) continue;
    const set = presentBy.get(mark.personId) ?? new Set<string>();
    set.add(mark.eventId);
    presentBy.set(mark.personId, set);
    perEvent.set(mark.eventId, (perEvent.get(mark.eventId) ?? 0) + 1);
    if (!onRoster.has(mark.personId)) namesOff.set(mark.personId, mark.displayName);
  }

  const rows: BoardRow[] = roster.map((member) => {
    const present = presentBy.get(member.personId) ?? new Set<string>();
    return { ...member, onRoster: true, present, total: present.size };
  });

  const off = [...namesOff.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'he'))
    .map(([personId, displayName]) => {
      const present = presentBy.get(personId) ?? new Set<string>();
      return { personId, displayName, onRoster: false, present, total: present.size };
    });

  return { events: live, cancelled, rows: [...rows, ...off], perEvent };
}

export interface AttendanceSummary {
  /** Live occasions on the board. */
  occasions: number;
  /** Marks on them — person-days, the camp's total effort as a number. */
  marks: number;
  /** Roster members at none of them. */
  idle: number;
  /** Live occasions per kind, for the strip. */
  byKind: Record<AttendanceKind, number>;
}

export function summarizeBoard(board: Board): AttendanceSummary {
  const byKind: Record<AttendanceKind, number> = {
    work_day: 0, build_day: 0, shopping: 0, meeting: 0, other: 0,
  };
  for (const event of board.events) byKind[event.kind] += 1;
  return {
    occasions: board.events.length,
    marks: board.rows.reduce((sum, row) => sum + row.total, 0),
    idle: board.rows.filter((row) => row.onRoster && row.total === 0).length,
    byKind,
  };
}

/**
 * The column header's words for an occasion: its title when it has one,
 * otherwise the kind. Spelled once so the board, the drawer and the toast
 * name an occasion the same way.
 */
export function eventLabel(event: Pick<AttendanceEvent, 'kind' | 'title'>): string {
  return event.title ?? ATTENDANCE_KIND_LABELS[event.kind];
}

const WEEKDAY = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' });

/** `יום שלישי` for `2026-03-10`. Read from the calendar, never assumed. */
export function weekdayOf(day: string): string {
  return WEEKDAY.format(new Date(`${day}T12:00:00Z`));
}

/** `2026-03-10` as the instant `DateText` formats back to that day. */
export function civilDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}
