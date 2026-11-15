import { ACT_PARAM } from '@/components/ui/drawer-url';

/**
 * The נוכחות board's URL, and the only place it is spelled.
 *
 * Season-scoped (R5): the board is one season's. Every link carries
 * `season` forward.
 *
 * One drawer, in two modes:
 *
 * - `?event=<id>` — one occasion: its day, its kind, its title, and who was
 *   there. Not `peek`, because the record is an occasion and the shared
 *   param name would read as "a person" to anyone who knows the other
 *   screens.
 * - `?act=event` — a new occasion. An `event` beside it is ignored: a URL
 *   naming both a record and the create verb means the record, which is
 *   the narrower thing somebody asked to see.
 */

export const ATTENDANCE_PATH = '/logistics/attendance';

export const NEW_EVENT_ACT = 'event';
export const EVENT_PARAM = 'event';

export interface AttendanceQuery {
  /** Empty means "the page picks", which `resolveSeason` does. */
  season: string;
  /** `?event=<id>`: the drawer over one occasion. */
  peekEvent: string | null;
  /** `?act=event` with no occasion named: the drawer that adds one. */
  creating: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Never throws: every param here can arrive mangled from a pasted link. */
export function parseAttendanceQuery(params: RawParams): AttendanceQuery {
  const event = one(params[EVENT_PARAM]) || null;
  const act = one(params[ACT_PARAM]);
  return {
    season: one(params.season),
    peekEvent: event,
    creating: event === null && act === NEW_EVENT_ACT,
  };
}

const KEYS = ['season'] as const;
type PatchKey = (typeof KEYS)[number] | typeof EVENT_PARAM | typeof ACT_PARAM;

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
