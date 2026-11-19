/**
 * The ימי עבודה screen's URL, and the only place it is spelled.
 *
 * Season-scoped (R5). Two more params:
 *
 * - `?day=<occasionId>` — which work day is on screen. Absent means "the
 *   page picks": the next one from today.
 * - `?task=<itemId>` — the drawer that sets who is on that task (R6: a
 *   drawer is a URL). It keeps `day`, so closing it lands on the same day.
 *
 * Free of the database: the client drawer imports this file.
 */

export const WORKDAYS_PATH = '/logistics/plan/workdays';

export const DAY_PARAM = 'day';
export const TASK_PARAM = 'task';

export interface WorkdaysQuery {
  /** Empty means "the page picks", which `resolveSeason` does. */
  season: string;
  day: string | null;
  task: string | null;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Never throws: every param here can arrive mangled from a pasted link. */
export function parseWorkdaysQuery(params: RawParams): WorkdaysQuery {
  return {
    season: one(params.season),
    day: one(params[DAY_PARAM]) || null,
    task: one(params[TASK_PARAM]) || null,
  };
}

/** The screen on one season, optionally one day, optionally one task's drawer. */
export function workdaysHref(
  params: RawParams, patch: { day?: string | null; task?: string | null } = {},
): string {
  const next = new URLSearchParams();
  const season = one(params.season);
  if (season) next.set('season', season);
  const day = patch.day === undefined ? one(params[DAY_PARAM]) : patch.day;
  if (day) next.set(DAY_PARAM, day);
  if (patch.task) next.set(TASK_PARAM, patch.task);
  const qs = next.toString();
  return qs ? `${WORKDAYS_PATH}?${qs}` : WORKDAYS_PATH;
}

const WEEKDAY = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'long' });

/** `יום שבת` for `2026-03-14`. Read from the calendar, never assumed. */
export function weekdayOf(day: string): string {
  return WEEKDAY.format(new Date(`${day}T12:00:00Z`));
}

/** `14/03/2026`. */
export function shortDate(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/**
 * An item's days in words: `בלי יום`, the one day with its weekday, or the
 * span `14/03/2026–16/03/2026`. For the pool's rows and the toasts that
 * name the days a pull or a removal changed.
 */
export function daysWords(startsOn: string | null, endsOn: string | null): string {
  if (startsOn === null) return 'בלי יום';
  if (endsOn === null || endsOn === startsOn) return `${weekdayOf(startsOn)} ${shortDate(startsOn)}`;
  return `${shortDate(startsOn)}–${shortDate(endsOn)}`;
}
