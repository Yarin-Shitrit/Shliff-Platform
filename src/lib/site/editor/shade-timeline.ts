import type { EditorDoc } from './model';
import { CAMP_SITE, jerusalemInstant, shadeAtHour, sunPosition, type ShadeAtHour } from './sun';

/**
 * Shade across the hours of the burn, fast-forwarded (spec §11): when the
 * things under the nets stand in shade, day by day. The pure core the
 * simulation's slider and timeline call, over `shadeAtHour`. Every hour
 * here is an Asia/Jerusalem clock hour, fractional (14.25 is 14:15).
 *
 * The horizon is the one `shadeAtHour` uses: the sun is up while `sunPosition`'s
 * `elevationDeg` is above 0. That elevation is refraction-corrected, so it
 * is the centre of the disc seen on a flat horizon — about 34′ below the
 * geometric horizon, which puts the camp's November sunrise some 2¾ minutes
 * before geometric 0's. Not the published sunrise either, which takes the
 * disc's upper limb and so falls a minute or so earlier still. The same horizon everywhere means every moment
 * between `rise` and `set` has shade to count.
 */

export interface Daylight {
  /** The clock hour the sun comes up, to within a second. */
  rise: number;
  /** The clock hour it goes down. */
  set: number;
}

export interface ShadeSample {
  date: string;
  /** A whole step on the clock: `hour · 60` is a whole multiple of the step. */
  hour: number;
  counts: ShadeAtHour;
}

/** `full` counts full shade only; `any` counts full and part shade. */
export type ShadeWindowKind = 'full' | 'any';

/**
 * A run of samples on one day in which most of what stands under the nets is
 * in shade. `from` and `to` are the first and last such samples' clock hours,
 * both inclusive, so a window of one sample has `from === to`. Where the shade
 * began or ended between two samples is not known, and is not guessed.
 */
export interface ShadeWindow {
  date: string;
  from: number;
  to: number;
}

/** The half-hour grid `daylight` scans for the sun crossing the horizon. */
const SCAN_STEPS = 48;
/** Bisect a crossing until it is pinned to a second. */
const ONE_SECOND = 1 / 3600;

/** Refuses anything but a real calendar day written YYYY-MM-DD. */
function readDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match !== null) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const at = new Date(Date.UTC(year, month - 1, day));
    if (at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day) return;
  }
  throw new Error(`a shade date must be a real YYYY-MM-DD day: ${date}`);
}

const HOUR_MS = 3_600_000;

/**
 * The instant of each fractional clock hour of `date`, to the millisecond,
 * as `jerusalemInstant` has it. It reads the time-zone database through
 * `Intl`, the costly part of a simulation, so it is asked twice a day, not
 * hundreds of times: when the day's two midnights stand 24 hours apart the
 * clock kept one offset all day (Israel changes it at most once a day), and
 * every hour is that many hours past midnight — exactly what
 * `jerusalemInstant` returns. On the two days a year the clocks change, it
 * is asked for each whole minute, and the seconds past it are added on.
 */
function clockOn(date: string): (hour: number) => Date {
  const midnight = jerusalemInstant(date, 0).getTime();
  if (jerusalemInstant(date, 24).getTime() - midnight === 24 * HOUR_MS) {
    // Rounded: 08:10 is 490 / 60 hours, 29 399 999.999999996 ms, and `Date` would cut it to the millisecond before.
    return (hour) => new Date(midnight + Math.round(hour * HOUR_MS));
  }
  return (hour) => {
    const minute = Math.floor(hour * 60);
    return new Date(jerusalemInstant(date, minute / 60).getTime() + Math.round((hour * 60 - minute) * 60_000));
  };
}

/**
 * Narrows `[down, up]`, or `[up, down]`, to where the sun crosses the horizon,
 * keeping one end where it is up and one where it is not, and returns the end
 * where it is up.
 */
function crossing(isUp: (hour: number) => boolean, down: number, up: number): number {
  let [sunDown, sunUp] = [down, up];
  while (Math.abs(sunUp - sunDown) > ONE_SECOND) {
    const mid = (sunDown + sunUp) / 2;
    if (isUp(mid)) sunUp = mid;
    else sunDown = mid;
  }
  return sunUp;
}

/**
 * When the sun rises and sets on `date` at `site` (the camp's, unless told
 * otherwise), on the horizon above. Found on a half-hour scan of the clock
 * day, then by bisection. Null unless the day holds one sunrise and one
 * sunset, the sun down at both midnights: a polar night, a midnight sun, or
 * a day that begins in daylight has no single span to give, and none is
 * made up. At the camp's latitude the day always has one.
 */
export function daylight(
  date: string,
  site: { latitude: number; longitude: number } = CAMP_SITE,
): Daylight | null {
  readDate(date);
  return daylightOn(clockOn(date), site);
}

function daylightOn(clock: (hour: number) => Date, site: { latitude: number; longitude: number }): Daylight | null {
  const isUp = (hour: number) => sunPosition(clock(hour), site.latitude, site.longitude).elevationDeg > 0;

  let before = isUp(0);
  if (before) return null;
  let riseAfter: number | null = null;
  let setAfter: number | null = null;
  let crossings = 0;
  for (let step = 1; step <= SCAN_STEPS; step += 1) {
    const hour = (24 * step) / SCAN_STEPS;
    const now = isUp(hour);
    if (now !== before) {
      crossings += 1;
      if (now) riseAfter = hour - 24 / SCAN_STEPS;
      else setAfter = hour - 24 / SCAN_STEPS;
    }
    before = now;
  }
  if (crossings !== 2 || riseAfter === null || setAfter === null) return null;
  const halfHour = 24 / SCAN_STEPS;
  return {
    rise: crossing(isUp, riseAfter, riseAfter + halfHour),
    set: crossing(isUp, setAfter + halfHour, setAfter),
  };
}

/**
 * The shade under the nets through each day's daylight, every `stepMinutes`
 * on the clock: at whole multiples of the step counted from midnight (06:00,
 * 06:15, … for 15), from the first at or after sunrise to the last at or
 * before sunset. Chronological; a day without daylight adds nothing. The
 * dates must be ascending and distinct — they are refused, not reordered.
 */
export function shadeTimeline(doc: EditorDoc, dates: readonly string[], stepMinutes: number): ShadeSample[] {
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0) {
    throw new Error(`a shade step must be a whole number of minutes above 0: ${stepMinutes}`);
  }
  dates.forEach((date, index) => {
    readDate(date);
    if (index > 0 && dates[index - 1] >= date) {
      throw new Error(`shade dates must be in order, each once: ${dates[index - 1]} then ${date}`);
    }
  });

  const samples: ShadeSample[] = [];
  for (const date of dates) {
    const clock = clockOn(date);
    const day = daylightOn(clock, CAMP_SITE);
    if (day === null) continue;
    const first = Math.ceil((day.rise * 60) / stepMinutes) * stepMinutes;
    for (let minute = first; minute <= day.set * 60; minute += stepMinutes) {
      const hour = minute / 60;
      const sun = sunPosition(clock(hour), CAMP_SITE.latitude, CAMP_SITE.longitude);
      const counts = shadeAtHour(doc, sun);
      // Between rise and set the sun is up by construction; were it not, this
      // moment would not be daylight, and it has no shade to count.
      if (counts !== null) samples.push({ date, hour, counts });
    }
  }
  return samples;
}

/**
 * The runs of samples, within one day, in which most of what stands under
 * the nets — strictly more than half of `under` — is in shade: full shade
 * only for `full`, full or part shade for `any`. Nothing under a net is no
 * shade to speak of: no window. A run ends with its day, never crossing the
 * night. The samples come in time order, as `shadeTimeline` gives them.
 */
export function shadeWindows(samples: readonly ShadeSample[], kind: ShadeWindowKind): ShadeWindow[] {
  if (kind !== 'full' && kind !== 'any') throw new Error(`a shade window kind must be full or any: ${String(kind)}`);
  const windows: ShadeWindow[] = [];
  let open: ShadeWindow | null = null;
  let previous: ShadeSample | null = null;
  for (const sample of samples) {
    if (previous !== null && (previous.date > sample.date || (previous.date === sample.date && previous.hour >= sample.hour))) {
      throw new Error(`shade samples must be in time order: ${previous.date} ${previous.hour} then ${sample.date} ${sample.hour}`);
    }
    previous = sample;
    const { under, full, partial } = sample.counts;
    const shaded = kind === 'full' ? full : full + partial;
    const most = under > 0 && shaded * 2 > under;
    if (open !== null && (!most || open.date !== sample.date)) {
      windows.push(open);
      open = null;
    }
    if (!most) continue;
    if (open === null) open = { date: sample.date, from: sample.hour, to: sample.hour };
    else open.to = sample.hour;
  }
  if (open !== null) windows.push(open);
  return windows;
}
