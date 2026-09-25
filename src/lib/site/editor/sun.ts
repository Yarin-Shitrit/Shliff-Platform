import { itemHeight } from '../defaults';
import { toPlaced } from '../derive';
import { overlap, shadedRect, type Rect } from '../geometry';
import type { Vec3 } from './camera';
import { rectOf, type EditorDoc } from './model';

/**
 * Where the sun is, and where the nets' shade falls, at an hour of the burn
 * (spec §11). The position is NOAA's solar-position approximation (the
 * "General Solar Position Calculations" behind NOAA's solar calculator),
 * good to a fraction of a degree between 1800 and 2100 — far finer than a
 * net's sag. Pure and deterministic; the one outside fact it reads is the
 * time-zone database, through `Intl`, for Asia/Jerusalem's summer time.
 */

/** The Midburn event pin, from the camp lead, 2026-09-24. A kilometre either way moves the sun by about 0.01°. */
export const CAMP_SITE = { latitude: 30.6154, longitude: 34.7988 } as const;

export interface SunPosition {
  /** Compass bearing of the sun, clockwise from true north. */
  azimuthDeg: number;
  /** Above the horizon, corrected for atmospheric refraction as NOAA's calculator does. */
  elevationDeg: number;
}

const RAD = Math.PI / 180;

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** NOAA's refraction correction, in degrees. */
function refraction(elevationDeg: number): number {
  if (elevationDeg > 85) return 0;
  const tan = Math.tan(elevationDeg * RAD);
  let arcSeconds: number;
  if (elevationDeg > 5) arcSeconds = 58.1 / tan - 0.07 / tan ** 3 + 0.000086 / tan ** 5;
  else if (elevationDeg > -0.575) {
    arcSeconds = 1735 + elevationDeg * (-518.2 + elevationDeg * (103.4 + elevationDeg * (-12.79 + elevationDeg * 0.711)));
  } else arcSeconds = -20.772 / tan;
  return arcSeconds / 3600;
}

export function sunPosition(instant: Date, latitude: number, longitude: number): SunPosition {
  const julianDay = instant.getTime() / 86_400_000 + 2_440_587.5;
  const t = (julianDay - 2_451_545) / 36_525;
  const meanLongitude = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
  const meanAnomaly = (357.52911 + t * (35_999.05029 - 0.0001537 * t)) * RAD;
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = Math.sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * meanAnomaly) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLongitude = (meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));

  // The equation of time, in minutes: how far the sundial runs ahead of the clock.
  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = meanLongitude * RAD;
  const equationOfTime = (4 / RAD) * (
    y * Math.sin(2 * l0)
    - 2 * eccentricity * Math.sin(meanAnomaly)
    + 4 * eccentricity * y * Math.sin(meanAnomaly) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly)
  );

  const utcMinutes = mod(instant.getTime() / 60_000, 1440);
  const solarMinutes = mod(utcMinutes + equationOfTime + 4 * longitude, 1440);
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const lat = latitude * RAD;

  const cosZenith = Math.min(1, Math.max(-1,
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)));
  const elevation = 90 - Math.acos(cosZenith) / RAD;
  const azimuth = mod(Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat),
  ) / RAD + 180, 360);
  return { azimuthDeg: azimuth, elevationDeg: elevation + refraction(elevation) };
}

let jerusalemClock: Intl.DateTimeFormat | null = null;

/** Minutes Asia/Jerusalem is ahead of UTC at an instant: 180 in summer time, 120 otherwise. */
function jerusalemOffset(at: number): number {
  jerusalemClock ??= new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const parts = jerusalemClock.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/**
 * The instant a clock in Asia/Jerusalem shows `hour` (fractional: 14.25 is
 * 14:15) on `date`. Israel's summer time is read from the time-zone
 * database, never from a rule written here. A clock hour skipped by the
 * spring change lands an hour later; the slider (07:00–18:00) never asks.
 */
export function jerusalemInstant(date: string, hour: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new Error(`a sun date must be YYYY-MM-DD: ${date}`);
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, Math.round(hour * 60));
  // The offset at the wall time read as UTC is right except within hours of a change; one more look settles it.
  const first = wall - jerusalemOffset(wall) * 60_000;
  return new Date(wall - jerusalemOffset(first) * 60_000);
}

/**
 * The unit map vector for a compass bearing. The map's up (−y) points to
 * `northDeg` (spec §5), and bearings run clockwise, as the map does.
 */
export function mapDirection(bearingDeg: number, northDeg: number): [number, number] {
  const turn = (bearingDeg - northDeg) * RAD;
  return [Math.sin(turn), -Math.cos(turn)];
}

/** The unit vector toward the sun in map coordinates (x east of the map, y south of it, z up). */
export function sunDirection(sun: SunPosition, northDeg: number): Vec3 {
  const [x, y] = mapDirection(sun.azimuthDeg, northDeg);
  const flat = Math.cos(sun.elevationDeg * RAD);
  return [x * flat, y * flat, Math.sin(sun.elevationDeg * RAD)];
}

/**
 * How far the shadow of a point `heightCm` above the ground falls from the
 * point: away from the sun, `height · cot(elevation)` long. Null when the sun
 * is down.
 */
export function shadowOffset(sun: SunPosition, northDeg: number, heightCm: number): { dxCm: number; dyCm: number } | null {
  if (sun.elevationDeg <= 0) return null;
  const [x, y] = mapDirection(sun.azimuthDeg, northDeg);
  const length = heightCm / Math.tan(sun.elevationDeg * RAD);
  return { dxCm: -x * length, dyCm: -y * length };
}

export interface ShadeAtHour {
  under: number;
  full: number;
  partial: number;
  sun: number;
}

function within(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.depth <= outer.y + outer.depth;
}

/**
 * Where each net's shade falls at `sun`: its shaded ground, cast away from
 * the sun from the height of its cloth (the net's own height, else its
 * kind's). Null while the sun is down — there is no shade to cast. The one
 * place this geometry is written: `shadeAtHour` and the tent ranking
 * (`shade-timeline.ts`) both read it.
 */
export function castShades(doc: EditorDoc, sun: SunPosition): Rect[] | null {
  if (sun.elevationDeg <= 0) return null;
  const cast: Rect[] = [];
  for (const net of doc.items) {
    if (net.kind !== 'shade') continue;
    const shaded = shadedRect(toPlaced(net));
    const offset = shadowOffset(sun, doc.plot.northDeg, itemHeight(net, doc.defaults));
    if (shaded === null || offset === null) continue;
    cast.push({ ...shaded, x: shaded.x + offset.dxCm, y: shaded.y + offset.dyCm });
  }
  return cast;
}

export type ItemShade = 'full' | 'partial' | 'sun';

/**
 * How a footprint stands against the cast shades: wholly inside some one of
 * them is full shade, touching any is part shade, the rest is sun. Wherever
 * the footprint is — under a net's own footprint or beside it, where a low
 * sun throws the shade.
 */
export function itemShade(footprint: Rect, cast: readonly Rect[]): ItemShade {
  if (cast.some((shade) => within(shade, footprint))) return 'full';
  if (cast.some((shade) => overlap(shade, footprint))) return 'partial';
  return 'sun';
}

/**
 * "בשעה 14:00, מתוך 13 פריטים מתחת לרשתות: 4 בצל מלא, 4 בצל חלקי, 5 בשמש"
 * (spec §11). `under` counts what stands under some net's footprint, and
 * each of those is in full shade, part shade or the sun by `itemShade`
 * against `castShades`. Null while the sun is down.
 */
export function shadeAtHour(doc: EditorDoc, sun: SunPosition): ShadeAtHour | null {
  const cast = castShades(doc, sun);
  if (cast === null) return null;
  const nets = doc.items.filter((entry) => entry.kind === 'shade');
  const counts: ShadeAtHour = { under: 0, full: 0, partial: 0, sun: 0 };
  for (const entry of doc.items) {
    if (entry.kind === 'shade') continue;
    const footprint = rectOf(entry);
    if (!nets.some((net) => overlap(rectOf(net), footprint))) continue;
    counts.under += 1;
    counts[itemShade(footprint, cast)] += 1;
  }
  return counts;
}
