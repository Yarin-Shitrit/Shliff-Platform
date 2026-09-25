import {
  ACT_PARAM, PEEK_PARAM, closePeekHref, openActHref, openPeekHref,
} from '@/components/ui/drawer-url';

export const SITE_PATH = '/site';

/** `?act=plot`: the plot drawer — create the map, or change its size, grid and north. */
export const PLOT_ACT = 'plot';
/** `?act=copy`: the drawer that copies another season's map into this one. */
export const COPY_ACT = 'copy';
/**
 * `?act=season-date`: the shell's drawer for the opening date of the season
 * `?season=` names (ruling SD2) — the day shade by hour is worked out for.
 * The drawer is the shell's, not this page's; the site only links to it.
 */
export const SEASON_DATE_ACT = 'season-date';

export type RawParams = Record<string, string | string[] | undefined>;

/**
 * What `/site` reads from its address. The editor is the page (Task 26):
 * `?editor=3d`, the flag it sat behind, is read by nothing — an old link that
 * carries it opens the editor like any other (ruling T26-1) — and so is the
 * retired board's `?act=remove`.
 */
export interface SiteQuery {
  season: string;
  /** `?peek=<id>`: the item selected when the map loads — a deep link (spec §12). */
  peek: string | null;
  plot: boolean;
  copy: boolean;
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseSiteQuery(params: RawParams): SiteQuery {
  const act = one(params[ACT_PARAM]);
  return {
    season: one(params.season),
    peek: one(params[PEEK_PARAM]) || null,
    plot: act === PLOT_ACT,
    copy: act === COPY_ACT,
  };
}

/** Only the season survives from one URL to the next (R5); drawers are the kit's. */
function carried(params: RawParams): URLSearchParams {
  const next = new URLSearchParams();
  const season = one(params.season);
  if (season) next.set('season', season);
  return next;
}

/** The page itself, with any drawer closed. */
export function siteHref(params: RawParams): string {
  return closePeekHref(SITE_PATH, carried(params));
}

/** The map with this item selected when it loads (the table's rows link here). */
export function itemHref(params: RawParams, id: string): string {
  return openPeekHref(SITE_PATH, carried(params), id);
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
 * The longest burn the map plays through, in days. Midburn runs about a week;
 * a last day further off than this is a mistyped date, not a burn — said as
 * one, never played day by day through hundreds of chips (SIM2 fix round 1).
 */
export const MAX_BURN_DAYS = 14;

/**
 * What the burn's last day says of its length: `known` — a real day, on or
 * after the gate day and within `MAX_BURN_DAYS` of it; `missing` — none
 * recorded (today always: `seasons` has no end column yet, SIM3), or none
 * that is a real day; `early` — before the gate day; `long` — too far after
 * it. Only `known` is a length to play.
 */
export type BurnEnd = 'known' | 'missing' | 'early' | 'long';

export function burnEnd(gateDay: string | null, lastDay: string | null): BurnEnd {
  const first = readSunDate(gateDay);
  const last = readSunDate(lastDay);
  if (first === null || last === null) return 'missing';
  if (last < first) return 'early';
  const furthest = addDays(first, MAX_BURN_DAYS - 1);
  return furthest !== null && last > furthest ? 'long' : 'known';
}

/**
 * The days of the burn, from the gate day to its last day, each once and in
 * order — what shade by hour can play through (ruling SIM3). Only a last day
 * `burnEnd` calls `known` gives a length; without one the burn is the gate
 * day alone: its length is never guessed. No gate day, no days.
 */
export function burnDays(gateDay: string | null, lastDay: string | null): string[] {
  const first = readSunDate(gateDay);
  if (first === null) return [];
  const days = [first];
  const last = readSunDate(lastDay);
  if (last === null || burnEnd(first, last) !== 'known') return days;
  for (let next = addDays(first, 1); next !== null && next <= last; next = addDays(next, 1)) days.push(next);
  return days;
}
