import { ACT_PARAM } from '@/components/ui/drawer-url';

/**
 * The נוכחות board's URL, and the only place it is spelled.
 *
 * Season-scoped (R5): the board is one season's. Every link carries
 * `season` forward.
 *
 * Two drawers, each in two modes:
 *
 * - `?event=<id>` — one occasion: its day, its kind, its title, and who was
 *   there. Not `peek`, because the record is an occasion and the shared
 *   param name would read as "a person" to anyone who knows the other
 *   screens.
 * - `?act=event` — a new occasion.
 * - `?person=<id>` — one person's personal marks: the things they did on
 *   their own, and the form that adds one.
 * - `?act=personal` — a new personal mark, with the person still to pick.
 *
 * A URL naming a record and a create verb means the record, which is the
 * narrower thing somebody asked to see; a URL naming both records means
 * the occasion, because its drawer came first and a pasted link that old
 * should keep opening what it opened.
 */

export const ATTENDANCE_PATH = '/logistics/attendance';

export const NEW_EVENT_ACT = 'event';
export const EVENT_PARAM = 'event';
export const NEW_PERSONAL_ACT = 'personal';
export const PERSON_PARAM = 'person';

export interface AttendanceQuery {
  /** Empty means "the page picks", which `resolveSeason` does. */
  season: string;
  /** `?event=<id>`: the drawer over one occasion. */
  peekEvent: string | null;
  /** `?act=event` with no record named: the drawer that adds an occasion. */
  creating: boolean;
  /** `?person=<id>` with no occasion named: the drawer over one person's personal marks. */
  peekPerson: string | null;
  /** `?act=personal` with no record named: the drawer that adds a personal mark. */
  addingPersonal: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Never throws: every param here can arrive mangled from a pasted link. */
export function parseAttendanceQuery(params: RawParams): AttendanceQuery {
  const event = one(params[EVENT_PARAM]) || null;
  const person = event === null ? one(params[PERSON_PARAM]) || null : null;
  const act = event === null && person === null ? one(params[ACT_PARAM]) : '';
  return {
    season: one(params.season),
    peekEvent: event,
    creating: act === NEW_EVENT_ACT,
    peekPerson: person,
    addingPersonal: act === NEW_PERSONAL_ACT,
  };
}

const KEYS = ['season'] as const;
type PatchKey = (typeof KEYS)[number] | typeof EVENT_PARAM | typeof PERSON_PARAM | typeof ACT_PARAM;

/**
 * One param changed, the season preserved, and any open drawer dropped
 * unless the patch names it. Every link on the page is built here, so none
 * of them can forget the season.
 */
export function attendanceHref(
  params: RawParams,
  patch: Partial<Record<PatchKey, string | null>>,
): string {
  const next = new URLSearchParams();
  for (const key of KEYS) {
    const value = one(params[key]);
    if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${ATTENDANCE_PATH}?${qs}` : ATTENDANCE_PATH;
}

/** The drawer over one occasion (R6: a drawer is a URL). */
export function eventHref(params: RawParams, eventId: string): string {
  return attendanceHref(params, { [EVENT_PARAM]: eventId });
}

/** The drawer that adds an occasion. */
export function newEventHref(params: RawParams): string {
  return attendanceHref(params, { [ACT_PARAM]: NEW_EVENT_ACT });
}

/** The drawer over one person's personal marks. */
export function personHref(params: RawParams, personId: string): string {
  return attendanceHref(params, { [PERSON_PARAM]: personId });
}

/** The drawer that adds a personal mark, person still to pick. */
export function newPersonalHref(params: RawParams): string {
  return attendanceHref(params, { [ACT_PARAM]: NEW_PERSONAL_ACT });
}
