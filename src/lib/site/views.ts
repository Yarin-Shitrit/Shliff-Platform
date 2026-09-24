import {
  ACT_PARAM, PEEK_PARAM, closePeekHref, openActHref, openPeekHref,
} from '@/components/ui/drawer-url';

export const SITE_PATH = '/site';

/** `?act=plot`: the plot-size drawer — create the map, or resize its plot. */
export const PLOT_ACT = 'plot';
/** `?act=copy`: the drawer that copies another season's map into this one. */
export const COPY_ACT = 'copy';
/** `?peek=<id>&act=remove`: the confirmation over one item. */
export const REMOVE_ACT = 'remove';
/**
 * `?act=season-date`: the shell's drawer for the opening date of the season
 * `?season=` names (ruling SD2) — the day shade by hour is worked out for.
 * The drawer is the shell's, not this page's; the site only links to it.
 */
export const SEASON_DATE_ACT = 'season-date';

export type RawParams = Record<string, string | string[] | undefined>;

export interface SiteQuery {
  season: string;
  /** The item a drawer is open over. */
  peek: string | null;
  plot: boolean;
  copy: boolean;
  removing: boolean;
  /**
   * `?editor=3d`: the bare 3D map instead of the board — temporary, so the
   * scene can be checked in a browser before the panels exist (plan 03,
   * Task 20). Task 26 makes the editor the page and removes the flag.
   */
  editor3d: boolean;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseSiteQuery(params: RawParams): SiteQuery {
  const peek = one(params[PEEK_PARAM]) || null;
  const act = one(params[ACT_PARAM]);
  return {
    season: one(params.season),
    peek,
    plot: act === PLOT_ACT,
    copy: act === COPY_ACT,
    removing: peek !== null && act === REMOVE_ACT,
    editor3d: one(params.editor) === '3d',
  };
}

/**
 * The season survives from one URL to the next (R5); drawers are the kit's.
 * So does `?editor=3d` while the flag exists: a drawer opened from the editor
 * closes back into it, not onto the board. Task 26 removes the flag, and this
 * with it. Only the flag's own value is carried.
 */
function carried(params: RawParams): URLSearchParams {
  const next = new URLSearchParams();
  const season = one(params.season);
  if (season) next.set('season', season);
  if (one(params.editor) === '3d') next.set('editor', '3d');
  return next;
}

/** The page itself, with any drawer closed. */
export function siteHref(params: RawParams): string {
  return closePeekHref(SITE_PATH, carried(params));
}

export function itemHref(params: RawParams, id: string): string {
  return openPeekHref(SITE_PATH, carried(params), id);
}

export function removeItemHref(params: RawParams, id: string): string {
  return openPeekHref(SITE_PATH, carried(params), id, REMOVE_ACT);
}

export function plotHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), PLOT_ACT);
}

export function copyHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), COPY_ACT);
}

/** The season's opening date, from the sun card (ruling SD4): a figure links to what changes it. */
export function seasonDateHref(params: RawParams): string {
  return openActHref(SITE_PATH, carried(params), SEASON_DATE_ACT);
}

/**
 * The day shade by hour is worked out for (spec §11): the season's gate day,
 * as the calendar date it is in Israel. Null when the season has none — the
 * sun card then asks for one rather than guessing a day (§13).
 */
export function sunDateOf(startsOn: Date | null): string | null {
  if (startsOn === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(startsOn);
  const part = (type: 'year' | 'month' | 'day') => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const SUN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A day as `sunDateOf` writes it — `YYYY-MM-DD`, and a day the calendar has —
 * or null: anything else is no day, never a guess (§13). The one check of that
 * shape (plan 04, ruling P15): `SiteEditor` asks it once and hands only what
 * it accepts to the scene and the sun card, so neither keeps a pattern of its
 * own. What it accepts, `sun.ts` `jerusalemInstant` accepts.
 */
export function readSunDate(text: string | null): string | null {
  if (text === null) return null;
  const match = SUN_DATE.exec(text);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? text : null;
}

/**
 * `day` moved on by `days` whole calendar days (back, for a negative count),
 * written as `sunDateOf` writes a day. Calendar arithmetic only — no clock and
 * no time zone, so the night the clocks change is a day like any other. What
 * `readSunDate` refuses has no day to move: null, as is a part of a day, and a
 * day past the four-digit years it reads.
 */
export function addDays(day: string, days: number): string | null {
  if (readSunDate(day) === null || !Number.isInteger(days)) return null;
  // `readSunDate` has checked the shape, so the three numbers are there.
  const [year, month, date] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, date + days));
  return readSunDate(moved.toISOString().slice(0, 10));
}

/**
 * The days of the burn, from the gate day to its last day, each once and in
 * order — what shade by hour can play through (ruling SIM3). The last day is
 * not recorded anywhere yet (`seasons` has no end column), so without one the
 * burn is the gate day alone: its length is never guessed. A last day before
 * the gate day is no last day either. No gate day, no days.
 */
export function burnDays(gateDay: string | null, lastDay: string | null): string[] {
  const first = readSunDate(gateDay);
  if (first === null) return [];
  const last = readSunDate(lastDay);
  const days = [first];
  if (last === null) return days;
  for (let next = addDays(first, 1); next !== null && next <= last; next = addDays(next, 1)) days.push(next);
  return days;
}
